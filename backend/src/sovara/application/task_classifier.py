"""Deterministic task classifier (Slice 3, first version).

No LLM, no learning — explicit UI hints, input modality, then small
lexical/structural rules. Fast, observable, testable. Ambiguous input
falls back to GENERAL (never force a category without evidence).
"""

from __future__ import annotations

import re

from sovara.domain.model_provider import Modality, TaskCapability
from sovara.domain.routing import TaskProfile, TaskType

# Ordered keyword sets per task type. Matching is case-insensitive;
# keywords of length <= 3 require word boundaries ("why", "csv", "api").
_KEYWORDS: dict[TaskType, tuple[str, ...]] = {
    TaskType.VISION: (
        "image",
        "picture",
        "photo",
        "screenshot",
        "diagram",
        "visual",
        "video",
    ),
    TaskType.CODING: (
        "python",
        "function",
        "code",
        "coding",
        "bug",
        "debug",
        "script",
        "program",
        "implement",
        "refactor",
        "parse",
        "csv",
        "json",
        "sql",
        "api",
        "algorithm",
        "regex",
        "compile",
        "typescript",
        "javascript",
        "import",
        "pip",
        "npm",
        "def ",
        "class ",
    ),
    TaskType.REASONING: (
        "why",
        "prove",
        "proof",
        "reason",
        "solve",
        "calculation",
        "incorrect",
        "logic",
        "infer",
        "derive",
        "explain",
        "step by step",
        "step-by-step",
        "how come",
    ),
    TaskType.DOCUMENT: (
        "summar",
        "report",
        "document",
        "paper",
        "article",
        "brief",
        "memo",
        "tldr",
        "outline",
        "extract",
    ),
    TaskType.DATA: (
        "number",
        "data",
        "chart",
        "table",
        "comparison",
        "compare",
        "statistic",
        "stats",
        "plot",
        "graph",
        "metric",
        "dataset",
        "spreadsheet",
    ),
    TaskType.ANALYSIS: (
        "analy",
        "evaluat",
        "assess",
        "review",
        "audit",
        "investigat",
        "examin",
    ),
}

# Tie-break priority when several types match equally: most specific first.
_PRIORITY: tuple[TaskType, ...] = (
    TaskType.VISION,
    TaskType.CODING,
    TaskType.REASONING,
    TaskType.DOCUMENT,
    TaskType.DATA,
    TaskType.ANALYSIS,
)

_REQUIRED_TASKS: dict[TaskType, tuple[TaskCapability, ...]] = {
    TaskType.CODING: (TaskCapability.CODING,),
    TaskType.REASONING: (TaskCapability.REASONING,),
    TaskType.DOCUMENT: (TaskCapability.DOCUMENT,),
    TaskType.ANALYSIS: (TaskCapability.REASONING,),
    TaskType.VISION: (TaskCapability.VISION,),
    TaskType.DATA: (TaskCapability.REASONING,),
    TaskType.GENERAL: (),
}


def _compile(keyword: str) -> re.Pattern[str]:
    if len(keyword.strip()) <= 3:
        return re.compile(r"\b" + re.escape(keyword.strip()) + r"\b", re.IGNORECASE)
    return re.compile(re.escape(keyword), re.IGNORECASE)


_PATTERNS: dict[TaskType, tuple[re.Pattern[str], ...]] = {
    task: tuple(_compile(k) for k in keywords) for task, keywords in _KEYWORDS.items()
}


def _score(text: str) -> dict[TaskType, int]:
    return {
        task: sum(1 for pattern in patterns if pattern.search(text))
        for task, patterns in _PATTERNS.items()
    }


def classify_task(
    text: str,
    *,
    task_hint: TaskType | str | None = None,
    has_image: bool = False,
) -> TaskProfile:
    """Build the normalized task profile for one chat turn.

    Precedence: explicit UI hint > image modality > lexical rules > general.
    An unknown hint string is ignored (falls through to heuristics), never
    fatal — the router must work on raw text alone.
    """
    if task_hint is not None:
        try:
            hinted = (
                task_hint if isinstance(task_hint, TaskType) else TaskType(str(task_hint).lower())
            )
            return _profile(hinted, text, profile_source="explicit")
        except ValueError:
            pass  # unknown hint: fall through to heuristics
    if has_image:
        return _profile(TaskType.VISION, text, profile_source="modality")
    scores = _score(text or "")
    best = max(scores.values(), default=0)
    if best <= 0:
        return _profile(TaskType.GENERAL, text, profile_source="heuristic")
    winners = [task for task in _PRIORITY if scores.get(task, 0) == best]
    return _profile(winners[0], text, profile_source="heuristic")


def _profile(task_type: TaskType, text: str, *, profile_source: str) -> TaskProfile:
    modalities = [Modality.TEXT]
    if task_type == TaskType.VISION:
        modalities.append(Modality.IMAGE)
    return TaskProfile(
        task_type=task_type,
        modalities=modalities,
        required_tasks=list(_REQUIRED_TASKS[task_type]),
        context_chars=len(text or ""),
        tool_required=False,
        profile_source=profile_source,
    )
