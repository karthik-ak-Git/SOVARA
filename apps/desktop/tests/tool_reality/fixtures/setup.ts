import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface TestWorkspaceFixture {
  workspaceRoot: string
  cleanup: () => void
}

/**
 * Creates a deterministic, completely isolated temporary workspace
 * with realistic synthetic files for testing SOVARA tools.
 */
export function createTestWorkspace(): TestWorkspaceFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-tool-reality-ws-'))

  // 1. production_notes.txt
  fs.writeFileSync(
    path.join(tmpDir, 'production_notes.txt'),
    `Machine A:
Production rate: 120 units/hour
Downtime: 30 minutes

Machine B:
Production rate: 150 units/hour
Downtime: 45 minutes

Machine C:
Production rate: 90 units/hour
Downtime: 20 minutes`,
    'utf-8'
  )

  // 2. production_notes.txt.txt (duplicate extension for recovery test)
  fs.writeFileSync(
    path.join(tmpDir, 'production_notes.txt.txt'),
    `[Recovery File]
Machine A: 120 units/hour
Machine B: 150 units/hour
Machine C: 90 units/hour`,
    'utf-8'
  )

  // 3. machine_config.json
  fs.writeFileSync(
    path.join(tmpDir, 'machine_config.json'),
    JSON.stringify(
      {
        factory: 'Plant Alpha',
        line: 1,
        machines: [
          { id: 'A', rate: 120, targetHours: 5 },
          { id: 'B', rate: 150, targetHours: 4 },
          { id: 'C', rate: 90, targetHours: 6 },
        ],
      },
      null,
      2
    ),
    'utf-8'
  )

  // 4. safety_rules.md
  fs.writeFileSync(
    path.join(tmpDir, 'safety_rules.md'),
    `# Industrial Safety Rules
1. Always wear protective gear near Machine A and B.
2. Emergency stop switches must be inspected daily.
3. Max operating temperature is 85°C.`,
    'utf-8'
  )

  // 5. valid_script.py
  fs.writeFileSync(
    path.join(tmpDir, 'valid_script.py'),
    `import sys

a_total = 120 * 5
b_total = 150 * 4
c_total = 90 * 6
grand_total = a_total + b_total + c_total

print(f"Machine A: {a_total}")
print(f"Machine B: {b_total}")
print(f"Machine C: {c_total}")
print(f"TOTAL_PRODUCTION: {grand_total}")
sys.exit(0)
`,
    'utf-8'
  )

  // 6. broken_script.py
  fs.writeFileSync(
    path.join(tmpDir, 'broken_script.py'),
    `import sys
# Intentional syntax error
def calculate_total(:
    return 120 * 5 +
sys.exit(1)
`,
    'utf-8'
  )

  // 7. interactive_hang.py (waits for stdin or times out)
  fs.writeFileSync(
    path.join(tmpDir, 'interactive_hang.py'),
    `import time
import sys
# Simulates interactive waiting
try:
    val = input("Enter confirmation: ")
except EOFError:
    pass
time.sleep(2)
`,
    'utf-8'
  )

  // 8. nested directory structure
  const nestedDir = path.join(tmpDir, 'nested')
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.writeFileSync(
    path.join(nestedDir, 'report.md'),
    `# Nested Production Audit Report
- Audit Date: 2026-09-28
- Status: VERIFIED
- Efficiency: 94.2%`,
    'utf-8'
  )
  fs.writeFileSync(
    path.join(nestedDir, 'data.json'),
    JSON.stringify({ nested: true, items: [1, 2, 3] }, null, 2),
    'utf-8'
  )

  // 9. inspection.txt
  fs.writeFileSync(
    path.join(tmpDir, 'inspection.txt'),
    `Visual Inspection Batch 7:
No cracks found. Thermal camera readings within safe limit.`,
    'utf-8'
  )

  return {
    workspaceRoot: tmpDir,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* best-effort cleanup */
      }
    },
  }
}
