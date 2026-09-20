const fs = require('fs');
const content = `\nexport const STRUCTURED_OUTPUT_INSTRUCTION = \`EXECUTION & CODE GENERATION DIRECTIVE:
1. When asked to create, build, or update code or files:
   - You MUST write the actual code. NEVER output a JSON response or fake summary alone claiming files were created.
   - Use the \\\`fs_write\\\` tool with the full, production-ready code: e.g. fs_write {"path": "dashboard.html", "content": "<!DOCTYPE html>..."}.
   - In your conversational output, ALWAYS provide the complete code inside a named markdown code block (e.g. \\\`\\\`\\\`html, \\\`\\\`\\\`javascript, \\\`\\\`\\\`css) so the user and the live artifact viewer can run it.
2. NEVER output empty placeholders, repetitive dummy scripts, or pretend that files were created without actually writing them.
3. For normal conversational chat and questions, respond directly in standard markdown.\`;\n`;
fs.appendFileSync('d:/SOVARA/apps/desktop/src/main/backend/prompts/sovaraSystem.ts', content);
