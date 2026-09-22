---
name: superpower
description: "Intelligent Task Orchestration Engine: automatically interprets user intent, decomposes into ordered flows, dynamically maps and activates required skills (pptx, docx, xlsx, code), maintains semantic context preservation, and executes autonomous deliverable generation."
category: orchestration
risk: safe
source: superpower
---

# SUPERPOWER SKILL: Intelligent Task Orchestration Engine

## Overview

**Superpower** is an advanced skill that transforms your AI application into an intelligent, context-aware workflow orchestrator. It integrates all available tools, MCPs, skills, and local models into a cohesive system that interprets user intent, generates structured execution plans, and preserves context across entire conversations.

**Version**: 1.0
**Target Framework**: Next.js + FastAPI + Local LLMs
**Architecture**: Modular, stateful, context-preserving

---

## 1. CORE CAPABILITIES

### A. Flow & Tool Inventory
The Superpower maintains a real-time registry of:

```json
{
  "availableFlows": [
    "document-creation",
    "ppt-generation",
    "data-analysis",
    "code-generation",
    "image-synthesis",
    "workflow-automation"
  ],
  "mcp_servers": [
    {
      "name": "local-llm",
      "type": "language-model",
      "models": ["mistral-7b", "llama-2", "neural-chat"],
      "capabilities": ["text-generation", "code-generation", "analysis"]
    },
    {
      "name": "local-image-generation",
      "type": "image-synthesis",
      "models": ["stable-diffusion-xl", "animagine"],
      "capabilities": ["image-generation", "image-editing"]
    },
    {
      "name": "document-processing",
      "type": "file-handler",
      "formats": ["docx", "pptx", "xlsx", "pdf", "md"],
      "capabilities": ["create", "read", "edit", "export"]
    }
  ],
  "skills": [
    "docx",
    "pptx",
    "xlsx",
    "pdf",
    "frontend-design",
    "file-reading",
    "algorithmic-art",
    "brand-guidelines"
  ],
  "contextCompression": {
    "enabled": true,
    "strategy": "semantic-summary",
    "tokenLimit": 4000
  }
}
```

---

## 2. MEMORY & CONTEXT PRESERVATION SYSTEM

### A. Session Naming Convention

**Format**: `[PROJECT_NAME]_[USER_HANDLE]_[SESSION_ID]`

**Example Names**:
- `NextJS_App_Karthik_AI_Session_001`
- `PPT_Generator_Karthik_DocFlow_Session_002`
- `Data_Pipeline_Karthik_Analytics_Session_003`

**How It Works**:
1. User provides a session name at the start
2. This name becomes the **Memory Anchor** for all subsequent interactions
3. You repeat this name at the beginning of each new conversation
4. The system retrieves full context automatically

### B. Context Preservation Pipeline

```
User Provides Session Name
    ↓
System Creates Memory Anchor
    ↓
Stores: [Conversation History + Decisions + Artifacts]
    ↓
Next Session: Retrieve Using Same Name
    ↓
Resume with Full Context (No Loss)
```

**Implementation**:

```typescript
// Memory storage structure
interface SuperpowerMemory {
  sessionName: string;
  createdAt: string;
  lastAccessed: string;
  conversationHistory: Message[];
  decisionLog: Decision[];
  artifacts: Artifact[];
  contextSummary: string;
  tokenUsage: number;
}

// Retrieval function
async function retrieveSuperpowerMemory(sessionName: string): Promise<SuperpowerMemory> {
  const memory = await memoryStore.get(sessionName);
  if (!memory) {
    throw new Error(`Session "${sessionName}" not found. Create new or use existing name.`);
  }
  console.log(`✓ Context restored: ${sessionName}`);
  return memory;
}
```

### C. Semantic Context Compression

When token limits approach, compress intelligently:

```python
# Context compression strategy
class ContextCompressor:
    def compress_conversation(self, history: List[Message], limit: int = 4000) -> str:
        """
        Compress conversation preserving critical decisions and context
        """
        critical_points = self.extract_key_decisions(history)
        recent_context = self.get_recent_messages(history, window=10)
        
        summary = f"""
        ### CRITICAL DECISIONS
        {self.format_decisions(critical_points)}
        
        ### RECENT CONTEXT (Last 10 messages)
        {self.format_messages(recent_context)}
        
        ### CURRENT TASK STATUS
        {self.extract_task_status(history)}
        """
        
        return summary if len(summary) < limit else self.aggressive_compress(history)
```

---

## 3. STRUCTURED WORKFLOW GENERATION

### A. Multi-Stage Interpretation Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1: INTENT PARSING                                     │
├─────────────────────────────────────────────────────────────┤
│ • Identify primary task (PPT, document, code, analysis)    │
│ • Extract constraints (audience, style, format)            │
│ • Detect dependencies (related artifacts needed)           │
│ • Flag potential blockers                                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 2: RESOURCE MAPPING                                   │
├─────────────────────────────────────────────────────────────┤
│ • Match task to available skills                           │
│ • Select appropriate MCP servers                           │
│ • Check local model capabilities                           │
│ • Verify tool availability                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 3: FLOW GENERATION                                    │
├─────────────────────────────────────────────────────────────┤
│ • Create ordered step sequence                             │
│ • Define input/output for each step                        │
│ • Identify validation checkpoints                          │
│ • Plan fallback strategies                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 4: TO-DO LIST & IMPLEMENTATION PROMPT                │
├─────────────────────────────────────────────────────────────┤
│ • Break flow into actionable tasks                         │
│ • Create implementation checklist                          │
│ • Generate prompt for user review & approval               │
│ • Estimate time & resource requirements                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 5: EXECUTION & MONITORING                             │
├─────────────────────────────────────────────────────────────┤
│ • Execute steps in sequence                                │
│ • Monitor for context loss                                 │
│ • Validate at checkpoints                                  │
│ • Adjust on failures                                       │
└─────────────────────────────────────────────────────────────┘
```

### B. Example: PPT Generation Flow

**USER PROMPT**: *"Create a PPT on LLM training from scratch for ML engineers"*

**STAGE 1 OUTPUT**:
```
✓ Task: PPT Generation
✓ Audience: ML Engineers (technical, code-savvy)
✓ Scope: LLM training fundamentals
✓ Format: PowerPoint (.pptx)
✓ Constraints: Local models only, no external APIs
```

**STAGE 2 OUTPUT**:
```
✓ Primary Skill: pptx
✓ Supporting Skills: frontend-design, brand-guidelines
✓ MCP Servers: local-llm (text generation)
✓ Models Available: mistral-7b, llama-2
✓ Output Format: .pptx file
```

**STAGE 3 OUTPUT**:
```
Step 1: Outline generation
  - Use local LLM to create slide structure
  - Validate: 12-15 slides covering theory → implementation
  
Step 2: Content generation
  - Generate technical content for each slide
  - Validate: Accuracy, depth appropriate for ML engineers
  
Step 3: Visual design
  - Apply design system
  - Create code snippets where applicable
  - Validate: Visual hierarchy, readability
  
Step 4: Export & delivery
  - Compile to .pptx
  - Validate: File integrity, opening correctly
```

**STAGE 4 OUTPUT** (Implementation Prompt):
```
TO-DO LIST
===========
□ Approve slide structure (12-15 slides)
□ Review content outline
□ Confirm design style (technical, minimal)
□ Approve code examples inclusion
□ Select color scheme

IMPLEMENTATION PROMPT
=====================
Create a technical PowerPoint presentation titled "Training Large Language Models from Scratch" 
for an audience of ML engineers. Include:

1. Theoretical Foundation (3 slides)
   - Transformer architecture overview
   - Attention mechanisms
   - Scaling laws

2. Data Preparation (2 slides)
   - Tokenization strategies
   - Dataset curation

3. Training Pipeline (4 slides)
   - Loss functions
   - Optimization techniques
   - Mixed precision training
   - Distributed training setup

4. Evaluation & Fine-tuning (2 slides)
   - Benchmark selection
   - Evaluation metrics
   - Fine-tuning approaches

5. Practical Implementation (3 slides)
   - Using Hugging Face Transformers
   - PyTorch patterns
   - Deployment considerations

RESOURCES NEEDED
================
• Local LLM: mistral-7b or llama-2
• Skills: pptx, frontend-design
• Estimated time: 15-20 minutes
• Output: presentation.pptx

APPROVAL REQUIRED: YES
Ready to proceed? (Yes/No/Modify)
```

---

## 4. CORE SUPERPOWER FUNCTIONS

### A. Intent Recognition Engine

```python
class SuperpowerIntentRecognizer:
    """Interprets user intent and maps to available capabilities"""
    
    def recognize_intent(self, user_prompt: str) -> IntentMap:
        """
        Extract task type, constraints, dependencies, and resources
        """
        intent_map = {
            "primary_task": self.identify_task_type(user_prompt),
            "subtasks": self.decompose_task(user_prompt),
            "constraints": self.extract_constraints(user_prompt),
            "required_skills": self.map_to_skills(user_prompt),
            "required_mcps": self.map_to_mcps(user_prompt),
            "preferred_model": self.select_local_model(user_prompt),
            "output_format": self.determine_output_format(user_prompt),
            "dependencies": self.find_dependencies(user_prompt),
            "estimated_complexity": self.rate_complexity(user_prompt),
        }
        return intent_map
```

### B. Workflow Generator

```python
class SuperpowerWorkflowGenerator:
    """Generates step-by-step execution flows"""
    
    def generate_flow(self, intent_map: IntentMap) -> WorkflowSequence:
        """
        Create structured flow with validation checkpoints
        """
        flow = WorkflowSequence()
        
        for task in intent_map["subtasks"]:
            step = WorkflowStep(
                name=task["name"],
                description=task["description"],
                required_skills=task["skills"],
                required_mcps=task["mcps"],
                input_requirements=task["inputs"],
                output_specification=task["outputs"],
                validation_rules=task["validations"],
                fallback_strategy=task["fallback"],
                estimated_duration=task["duration"],
            )
            flow.add_step(step)
        
        return flow
```

### C. Context Preservation Engine

```python
class SuperpowerContextPreserver:
    """Maintains context throughout conversation"""
    
    def save_context(self, session_name: str, data: Dict) -> None:
        """
        Save conversation state with memory anchor
        """
        memory = SuperpowerMemory(
            sessionName=session_name,
            conversationHistory=data["history"],
            decisionLog=data["decisions"],
            artifacts=data["artifacts"],
            contextSummary=self.compress_context(data),
            lastAccessed=datetime.now().isoformat(),
        )
        self.storage.save(session_name, memory)
    
    def compress_context(self, data: Dict) -> str:
        """
        Use semantic compression for token efficiency
        """
        compressor = ContextCompressor()
        return compressor.compress_conversation(
            history=data["history"],
            limit=4000
        )
    
    def restore_context(self, session_name: str) -> SuperpowerMemory:
        """
        Restore full session context from memory anchor
        """
        return self.storage.get(session_name)
```

### D. Implementation Prompt Generator

```python
class SuperpowerPromptGenerator:
    """Generates detailed implementation prompts for review"""
    
    def generate_implementation_prompt(
        self, 
        intent_map: IntentMap,
        workflow: WorkflowSequence,
    ) -> ImplementationPrompt:
        """
        Create comprehensive prompt for user review
        """
        prompt = ImplementationPrompt(
            title=f"Implementation Plan: {intent_map['primary_task']}",
            checklist=self.create_todo_list(workflow),
            detailed_prompt=self.create_detailed_prompt(workflow),
            resources=self.list_required_resources(workflow),
            estimated_time=self.calculate_duration(workflow),
            approval_required=True,
            modifications_accepted=True,
        )
        return prompt
```

---

## 5. CONFIGURATION & SETUP

### A. Superpower Configuration File

```yaml
# superpower-config.yml
superpower:
  version: "1.0"
  name: "Intelligent Task Orchestrator"
  
  memory:
    enabled: true
    strategy: "semantic-summary"
    compression_enabled: true
    token_limit: 4000
    storage_backend: "redis" # or "filesystem"
    
  local_models:
    language_models:
      - name: "mistral-7b"
        endpoint: "http://localhost:8000"
        max_tokens: 4096
        temperature: 0.7
      - name: "llama-2"
        endpoint: "http://localhost:8001"
        max_tokens: 4096
        temperature: 0.7
      - name: "neural-chat"
        endpoint: "http://localhost:8002"
        max_tokens: 4096
        temperature: 0.7
    
    image_models:
      - name: "stable-diffusion-xl"
        endpoint: "http://localhost:7860"
        format: "png"
      - name: "animagine"
        endpoint: "http://localhost:7861"
        format: "png"
  
  available_skills:
    - name: "docx"
      capabilities: ["create", "edit", "export"]
      local: true
    - name: "pptx"
      capabilities: ["create", "edit", "export"]
      local: true
    - name: "xlsx"
      capabilities: ["create", "analyze", "export"]
      local: true
    - name: "pdf"
      capabilities: ["create", "read", "edit"]
      local: true
    - name: "frontend-design"
      capabilities: ["design-guidance", "theming"]
      local: true
    - name: "algorithmic-art"
      capabilities: ["generative-art"]
      local: true
  
  workflows:
    document_creation:
      steps: 5
      requires_skills: ["docx", "frontend-design"]
      requires_models: ["language_models"]
    
    ppt_generation:
      steps: 6
      requires_skills: ["pptx", "frontend-design"]
      requires_models: ["language_models"]
    
    data_analysis:
      steps: 4
      requires_skills: ["xlsx"]
      requires_models: ["language_models"]
    
    code_generation:
      steps: 5
      requires_skills: []
      requires_models: ["language_models"]
    
    image_synthesis:
      steps: 3
      requires_skills: ["algorithmic-art"]
      requires_models: ["image_models"]
```

### B. FastAPI Backend Integration

```python
# fastapi_superpower.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Optional
import json

app = FastAPI()

class SuperpowerRequest(BaseModel):
    session_name: str
    user_prompt: str
    retrieve_context: bool = True
    generate_todo: bool = True

class SuperpowerResponse(BaseModel):
    session_name: str
    intent_map: Dict
    workflow: List[Dict]
    todo_list: List[str]
    implementation_prompt: str
    approval_required: bool
    estimated_time: str

superpower = SuperpowerEngine(config_path="superpower-config.yml")

@app.post("/superpower/interpret")
async def interpret_and_plan(request: SuperpowerRequest) -> SuperpowerResponse:
    """
    Main Superpower endpoint: interpret intent, generate flow, create TODO
    """
    try:
        # Restore context if session exists
        if request.retrieve_context:
            try:
                context = superpower.restore_context(request.session_name)
                print(f"✓ Context restored for session: {request.session_name}")
            except:
                print(f"ℹ New session: {request.session_name}")
        
        # Stage 1: Intent Recognition
        intent_map = superpower.intent_recognizer.recognize_intent(request.user_prompt)
        
        # Stage 2: Resource Mapping
        resources = superpower.map_resources(intent_map)
        
        # Stage 3: Flow Generation
        workflow = superpower.workflow_generator.generate_flow(intent_map)
        
        # Stage 4: TODO List & Implementation Prompt
        todo_list = superpower.create_todo_list(workflow)
        impl_prompt = superpower.prompt_generator.generate_implementation_prompt(
            intent_map, 
            workflow
        )
        
        # Stage 5: Save context
        superpower.save_context(
            request.session_name,
            {
                "history": [{"role": "user", "content": request.user_prompt}],
                "decisions": [],
                "artifacts": [],
                "intent_map": intent_map,
                "workflow": workflow,
            }
        )
        
        return SuperpowerResponse(
            session_name=request.session_name,
            intent_map=intent_map,
            workflow=[step.dict() for step in workflow.steps],
            todo_list=todo_list,
            implementation_prompt=impl_prompt,
            approval_required=True,
            estimated_time=workflow.total_duration,
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/superpower/execute")
async def execute_approved_workflow(
    session_name: str,
    approval: bool,
) -> Dict:
    """
    Execute workflow after user approval
    """
    if not approval:
        return {"status": "waiting_for_approval"}
    
    context = superpower.restore_context(session_name)
    workflow = context["workflow"]
    
    results = []
    for step in workflow.steps:
        result = await superpower.execute_step(step, context)
        results.append(result)
        
        # Preserve context after each step
        superpower.save_context(session_name, context)
    
    return {
        "status": "completed",
        "session_name": session_name,
        "results": results,
    }

@app.get("/superpower/sessions/{session_name}")
async def get_session_info(session_name: str) -> Dict:
    """
    Retrieve session information and context summary
    """
    memory = superpower.restore_context(session_name)
    return {
        "session_name": session_name,
        "created_at": memory.createdAt,
        "last_accessed": memory.lastAccessed,
        "conversation_length": len(memory.conversationHistory),
        "context_summary": memory.contextSummary,
        "artifacts_created": len(memory.artifacts),
    }
```

### C. Next.js Frontend Integration

```typescript
// lib/superpower-client.ts
import axios from "axios";

export interface SuperpowerRequest {
  session_name: string;
  user_prompt: string;
  retrieve_context?: boolean;
  generate_todo?: boolean;
}

export interface WorkflowStep {
  name: string;
  description: string;
  required_skills: string[];
  validation_rules: string[];
  estimated_duration: string;
}

export interface SuperpowerResponse {
  session_name: string;
  intent_map: Record<string, any>;
  workflow: WorkflowStep[];
  todo_list: string[];
  implementation_prompt: string;
  approval_required: boolean;
  estimated_time: string;
}

export class SuperpowerClient {
  private apiBase = process.env.NEXT_PUBLIC_API_URL;

  async interpretAndPlan(request: SuperpowerRequest): Promise<SuperpowerResponse> {
    const response = await axios.post(
      `${this.apiBase}/superpower/interpret`,
      request
    );
    return response.data;
  }

  async executeWorkflow(
    sessionName: string,
    approval: boolean
  ): Promise<any> {
    const response = await axios.post(
      `${this.apiBase}/superpower/execute`,
      null,
      {
        params: { session_name: sessionName, approval },
      }
    );
    return response.data;
  }

  async getSessionInfo(sessionName: string): Promise<any> {
    const response = await axios.get(
      `${this.apiBase}/superpower/sessions/${sessionName}`
    );
    return response.data;
  }
}

// Usage in React component
// const superpower = new SuperpowerClient();
// const result = await superpower.interpretAndPlan({
//   session_name: "PPT_Generator_Karthik_Session_001",
//   user_prompt: "Create a PPT on LLM training",
// });
```

---

## 6. USAGE EXAMPLES

### Example 1: PPT Generation Session

```
USER: "Create a PPT on LLM training from scratch for ML engineers"

SESSION NAME: PPT_Training_Karthik_Session_001

SUPERPOWER OUTPUT:
├─ Intent: PPT generation for technical audience
├─ Required Skills: pptx, frontend-design
├─ Required Models: mistral-7b
├─ Workflow Steps: 6
├─ Context Status: ✓ Preserved
├─ TODO List:
│  □ Approve slide structure
│  □ Review content outline
│  □ Confirm design style
│  └─ Start execution
└─ Implementation Prompt: [Detailed prompt for review]
```

### Example 2: Resume Session

```
USER (Next Day): "Continue with PPT_Training_Karthik_Session_001"

SUPERPOWER OUTPUT:
✓ Session found and restored
✓ Previous context loaded:
  - 6 workflow steps defined
  - 3 slides completed
  - Design style: Technical Minimal
✓ Continuing from Step 4: Content Generation
```

### Example 3: Multi-Artifact Project

```
USER: "Create a complete course: PPT, guide document, code examples, and quiz"

SESSION NAME: AI_Course_Karthik_Complete_Project

SUPERPOWER OUTPUT:
Workflow: 4 parallel tracks
├─ Track 1: PPT generation (6 steps)
├─ Track 2: Guide document (5 steps)
├─ Track 3: Code example generation (4 steps)
└─ Track 4: Quiz creation (3 steps)

Context Compression: Enabled (smart summarization between tracks)
Memory Anchors: All tied to "AI_Course_Karthik_Complete_Project"
```

---

## 7. SESSION NAMING BEST PRACTICES

**Recommended Format**:
```
[PROJECT_TYPE]_[OWNER_NAME]_[DOMAIN]_Session_[NUMBER]
```

**Examples**:
- `PPT_Karthik_ML_Session_001`
- `API_Karthik_Backend_Session_002`
- `Dashboard_Karthik_Analytics_Session_001`
- `Course_Karthik_AIAgents_Session_003`

**Retrieval**:
```
At start of new chat, simply mention:
"Continue with [SESSION_NAME]"
OR
"Use context from [SESSION_NAME]"
```

---

## 8. KEY FEATURES SUMMARY

| Feature | Capability |
|---------|-----------|
| **Intent Recognition** | Automatically maps user requests to tasks |
| **Flow Generation** | Creates step-by-step execution plans |
| **Memory System** | Persists context using session names |
| **Context Compression** | Maintains context within token limits |
| **TODO Lists** | Actionable checklists for each workflow |
| **Implementation Prompts** | Detailed prompts for user review/approval |
| **Local Models** | Works exclusively with local LLMs |
| **Multi-Skill Support** | Integrates docx, pptx, xlsx, pdf, design, art |
| **Validation Checkpoints** | Ensures quality at each step |
| **Fallback Strategies** | Handles errors gracefully |

---

## 9. ACTIVATION CHECKLIST

- [ ] Deploy FastAPI backend with superpower endpoints
- [ ] Configure local model endpoints
- [ ] Set up Redis/filesystem for memory storage
- [ ] Configure `superpower-config.yml`
- [ ] Integrate Next.js frontend with SuperpowerClient
- [ ] Test intent recognition with sample prompts
- [ ] Verify context persistence across sessions
- [ ] Test context compression at token limits
- [ ] Create user documentation for session naming
- [ ] Set up monitoring/logging for workflow execution

---

## 10. SUPPORT & DEBUGGING

**Check Session Status**:
```
GET /superpower/sessions/{session_name}
```

**View Available Skills**:
```
GET /superpower/inventory
```

**List All Sessions**:
```
GET /superpower/sessions
```

**Clear Session** (archive):
```
POST /superpower/sessions/{session_name}/archive
```

---

## CONCLUSION

The **Superpower Skill** transforms your application into an intelligent orchestrator that:
✓ Understands complex requests clearly
✓ Generates structured workflows automatically
✓ Preserves context perfectly across sessions
✓ Never loses memory or history
✓ Works entirely with local models
✓ Supports all your tools (docx, pptx, xlsx, images, code)

**Start using it by naming your session, and repeat that name in every future conversation to never lose context.**

