import { useEffect, useState, useCallback } from 'react'
import { HelpCircle, ArrowLeft, ArrowRight, Check, Send, X } from 'lucide-react'

export interface ClarifyQuestion {
  id: string
  question: string
  options: string[]
  allowOther?: boolean
}

interface Props {
  questions: ClarifyQuestion[]
  onResolve: (answers: Record<string, string>) => void
  onSkip: () => void
}

const KEY_CAPS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * ClarifyWizardCard — guided question card (permission-card styling, centered).
 * One question per step; selecting an option advances to the next question.
 * Arrow keys / Back-Next buttons navigate; the final step is a summary of the
 * selected answers, and Confirm sends them back to the agent so it proceeds
 * on real answers + prior context instead of hallucinating.
 */
export function ClarifyWizardCard({ questions, onResolve, onSkip }: Props) {
  const total = questions.length
  const summaryStep = total // index of the summary screen
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const isSummary = step >= summaryStep
  const current = questions[Math.min(step, total - 1)]
  const answered = (q: ClarifyQuestion) => answers[q.id] !== undefined && answers[q.id] !== ''
  const canAdvance = isSummary || (current ? (answered(current) || (current.allowOther !== false && (otherText[current.id] ?? '').trim().length > 0)) : true)

  const goNext = useCallback(() => {
    if (!isSummary) {
      if (!canAdvance || !current) return
      // Commit a typed "other" answer if the user pressed Next instead of Use
      const finalAnswers = { ...answers }
      if (!finalAnswers[current.id]) {
        const typed = (otherText[current.id] ?? '').trim()
        if (typed) finalAnswers[current.id] = typed
      }
      setAnswers(finalAnswers)
      setStep((s) => Math.min(s + 1, summaryStep))
    } else {
      onResolve(answers)
    }
  }, [isSummary, canAdvance, current, summaryStep, answers, otherText, onResolve])

  const goPrev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), [])

  const selectOption = useCallback((q: ClarifyQuestion, value: string) => {
    setAnswers((prev) => ({ ...prev, [q.id]: value }))
    // Auto-advance to the next question on selection (unless it's the last step)
    setTimeout(() => {
      setStep((s) => (s < summaryStep ? Math.min(s + 1, summaryStep) : s))
      setOtherText((prev) => ({ ...prev, [q.id]: '' }))
    }, 180)
  }, [summaryStep])

  const selectOther = useCallback((q: ClarifyQuestion) => {
    const text = (otherText[q.id] ?? '').trim()
    if (!text) return
    setAnswers((prev) => ({ ...prev, [q.id]: text }))
    setTimeout(() => setStep((s) => Math.min(s + 1, summaryStep)), 180)
  }, [otherText, summaryStep])

  // Keyboard: 1-9 select option, Enter confirm/next, Arrow keys navigate, Esc skip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (e.key === 'Escape') { e.preventDefault(); onSkip(); return }
      if (typing) return // don't steal keys from the free-text answer box
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && canAdvance)) { e.preventDefault(); goNext(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); return }
      if (!isSummary && current) {
        const idx = KEY_CAPS.indexOf(e.key)
        if (idx >= 0 && idx < current.options.length) {
          e.preventDefault()
          selectOption(current, current.options[idx])
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isSummary, current, canAdvance, goNext, goPrev, onSkip, selectOption])

  const answeredCount = questions.filter(answered).length
  const allAnswered = answeredCount === total

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 960,
      background: 'rgba(2,6,23,0.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 560, background: '#0F172A',
        border: '1px solid #334155', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(2,6,23,0.6)',
        overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          background: 'linear-gradient(180deg, #16233B 0%, #101a2e 100%)',
          borderBottom: '1px solid #24324a',
        }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(59,130,246,0.15)', color: '#60A5FA', flexShrink: 0,
          }}>
            <HelpCircle size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', display: 'flex', gap: 6, alignItems: 'center' }}>
              The AI needs clarification
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                background: 'rgba(59,130,246,0.15)', color: '#60A5FA',
              }}>
                {isSummary ? 'SUMMARY' : `QUESTION ${step + 1} OF ${total}`}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
              {isSummary ? 'Review your answers, then send them to the AI.' : 'Answer to continue — pick an option or press 1-9.'}
            </div>
          </div>
          <button
            onClick={onSkip}
            title="Skip (Esc)"
            style={{
              width: 26, height: 26, borderRadius: 6, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', background: 'transparent',
              border: '1px solid #334155', color: '#64748B', cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, padding: '10px 16px 0', alignItems: 'center' }}>
          {questions.map((q, i) => (
            <span
              key={q.id}
              title={`Question ${i + 1}`}
              onClick={() => i <= answeredCount && setStep(i)}
              style={{
                width: i === step ? 18 : 7, height: 7, borderRadius: 4, cursor: i <= answeredCount ? 'pointer' : 'default',
                background: i === step ? '#60A5FA' : answered(q) ? '#3B82F6' : '#334155',
                transition: 'all .18s',
              }}
            />
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>{answeredCount}/{total} answered</span>
        </div>

        {/* Body */}
        <div style={{ padding: '12px 16px 6px', minHeight: 180 }}>
          {isSummary ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>
                Your answers
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {questions.map((q, i) => (
                  <div
                    key={q.id}
                    onClick={() => setStep(i)}
                    style={{
                      display: 'flex', gap: 10, padding: '9px 11px', borderRadius: 8,
                      background: '#131f36', border: '1px solid #26344d', cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: '#60A5FA', minWidth: 16,
                      paddingTop: 2,
                    }}>
                      {i + 1}.
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.4 }}>{q.question}</div>
                      <div style={{ fontSize: 12.5, color: '#F1F5F9', fontWeight: 600, marginTop: 2 }}>
                        {answers[q.id] ?? <span style={{ color: '#F59E0B', fontWeight: 500 }}>not answered</span>}
                      </div>
                    </div>
                    <span style={{ marginLeft: 'auto', color: '#3B82F6', flexShrink: 0, paddingTop: 2 }}>
                      <ArrowLeft size={12} style={{ transform: 'rotate(180deg)' }} />
                    </span>
                  </div>
                ))}
              </div>
              {!allAnswered && (
                <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 8 }}>
                  Some questions are unanswered — click a row to go back and answer.
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#F1F5F9', lineHeight: 1.45, marginBottom: 10 }}>
                {current.question}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {current.options.map((opt, i) => {
                  const selected = answers[current.id] === opt
                  return (
                    <button
                      key={i}
                      onClick={() => selectOption(current, opt)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '9px 11px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        background: selected ? 'rgba(59,130,246,0.16)' : '#131f36',
                        border: `1px solid ${selected ? '#3B82F6' : '#26344d'}`,
                        transition: 'all .12s',
                      }}
                    >
                      <span style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                        background: selected ? '#3B82F6' : '#1e2c48',
                        color: selected ? '#fff' : '#94A3B8',
                        border: `1px solid ${selected ? '#3B82F6' : '#334155'}`,
                      }}>
                        {selected ? <Check size={12} /> : i + 1}
                      </span>
                      <span style={{ fontSize: 12.5, color: '#E2E8F0', flex: 1, lineHeight: 1.4 }}>{opt}</span>
                    </button>
                  )
                })}

                {current.allowOther && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    <input
                      value={otherText[current.id] ?? ''}
                      onChange={(e) => setOtherText((p) => ({ ...p, [current.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); selectOther(current) } }}
                      placeholder="Or type your own answer…"
                      style={{
                        flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12.5,
                        background: '#0d1729', border: '1px solid #26344d', color: '#F1F5F9',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => selectOther(current)}
                      disabled={!(otherText[current.id] ?? '').trim()}
                      style={{
                        padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: (otherText[current.id] ?? '').trim() ? '#1d4ed8' : '#1e2c48',
                        color: (otherText[current.id] ?? '').trim() ? '#fff' : '#64748B',
                        border: '1px solid #26344d', cursor: 'pointer',
                      }}
                    >
                      Use
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
          borderTop: '1px solid #1e2c48', background: '#0d1729',
        }}>
          <button
            onClick={goPrev}
            disabled={step === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px',
              borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: step === 0 ? 'not-allowed' : 'pointer',
              background: '#131f36', color: step === 0 ? '#475569' : '#CBD5E1',
              border: '1px solid #26344d', opacity: step === 0 ? 0.55 : 1,
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>

          <span style={{ fontSize: 10.5, color: '#475569', fontWeight: 600 }}>
            {isSummary ? '← → to review · Enter to send' : '← → navigate · Enter next'}
          </span>

          <span style={{ flex: 1 }} />

          <button
            onClick={onSkip}
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: 'transparent', color: '#94A3B8', border: '1px solid #334155',
              cursor: 'pointer',
            }}
          >
            Skip
          </button>

          <button
            onClick={goNext}
            disabled={!canAdvance}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px',
              borderRadius: 8, fontSize: 12.5, fontWeight: 700,
              cursor: canAdvance ? 'pointer' : 'not-allowed',
              background: canAdvance ? (isSummary ? '#16a34a' : '#1d4ed8') : '#1e2c48',
              color: canAdvance ? '#fff' : '#64748B',
              border: `1px solid ${canAdvance ? (isSummary ? '#16a34a' : '#2563eb') : '#26344d'}`,
            }}
          >
            {isSummary ? (
              <><Send size={13} /> Send answers to AI</>
            ) : (
              <>{step + 1 === total ? 'Review' : 'Next'} <ArrowRight size={14} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
