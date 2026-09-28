export type FileCategory = 
  | 'text'
  | 'code'
  | 'markup'
  | 'office-word'
  | 'office-excel'
  | 'office-ppt'
  | 'pdf'
  | 'image'
  | 'archive'
  | 'database'
  | 'binary';

export interface FileUnderstanding {
  path: string;
  category: FileCategory;
  extractedContent: string | null;
  method: 'direct-read' | 'python-extraction' | 'shell-extraction' | 'vision' | 'ocr' | 'listing' | 'unsupported';
  confidence: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export function categorizeFile(pathOrMime: string): FileCategory {
  const clean = pathOrMime.toLowerCase().trim();
  const extMatch = clean.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1] : '';

  if (['txt', 'md', 'csv', 'json', 'yaml', 'yml', 'toml', 'xml', 'log', 'ini', 'cfg', 'env', 'gitignore'].includes(ext)) {
    return 'text';
  }
  if (['py', 'ts', 'js', 'jsx', 'tsx', 'java', 'cpp', 'c', 'h', 'hpp', 'rs', 'go', 'rb', 'php', 'swift', 'kt', 'scala', 'r', 'm', 'lua', 'sh', 'bash', 'ps1', 'bat', 'cmd', 'sql', 'graphql'].includes(ext)) {
    return 'code';
  }
  if (['html', 'htm', 'css', 'scss', 'less', 'svg', 'vue', 'svelte'].includes(ext)) {
    return 'markup';
  }
  if (['docx', 'doc'].includes(ext)) {
    return 'office-word';
  }
  if (['xlsx', 'xls'].includes(ext)) {
    return 'office-excel';
  }
  if (['pptx', 'ppt'].includes(ext)) {
    return 'office-ppt';
  }
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tiff'].includes(ext)) {
    return 'image';
  }
  if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2'].includes(ext)) {
    return 'archive';
  }
  if (['sqlite', 'sqlite3', 'db', 'mdb'].includes(ext)) {
    return 'database';
  }

  if (clean.startsWith('text/')) return 'text';
  if (clean.startsWith('image/')) return 'image';
  if (clean.includes('wordprocessingml')) return 'office-word';
  if (clean.includes('spreadsheetml')) return 'office-excel';
  if (clean.includes('presentationml')) return 'office-ppt';
  if (clean.includes('pdf')) return 'pdf';

  return 'binary';
}

export function getExtractionScript(category: FileCategory, filePath: string): string | null {
  const escaped = filePath.replace(/\\/g, '/');
  switch (category) {
    case 'office-word':
      return `python -c "from docx import Document; d=Document('${escaped}'); print('\\n'.join(p.text for p in d.paragraphs))"`;
    case 'office-excel':
      return `python -c "import openpyxl; wb=openpyxl.load_workbook('${escaped}'); [print(ws.title, [[c.value for c in r] for r in ws.iter_rows()]) for ws in wb]"`;
    case 'office-ppt':
      return `python -c "from pptx import Presentation; p=Presentation('${escaped}'); [print(s.shapes.title.text if s.shapes.title else '', '\\n'.join(sh.text for sh in s.shapes if sh.has_text_frame)) for s in p.slides]"`;
    case 'pdf':
      return `python -c "import PyPDF2; r=PyPDF2.PdfReader('${escaped}'); [print(p.extract_text()) for p in r.pages]"`;
    case 'archive':
      return `powershell -c "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; [IO.Compression.ZipFile]::OpenRead('${escaped}').Entries.FullName"`;
    case 'database':
      return `sqlite3 "${escaped}" ".tables" ".schema"`;
    default:
      return null;
  }
}

export function getFallbackExtractionScript(category: FileCategory, filePath: string): string | null {
  const escaped = filePath.replace(/\\/g, '/');
  switch (category) {
    case 'office-word':
      return `powershell -c "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; $z=[IO.Compression.ZipFile]::OpenRead('${escaped}'); $e=$z.Entries|Where{$_.FullName -eq 'word/document.xml'}; $s=$e.Open(); $r=[IO.StreamReader]::new($s); $r.ReadToEnd()"`;
    case 'office-excel':
      return `powershell -c "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; $z=[IO.Compression.ZipFile]::OpenRead('${escaped}'); $e=$z.Entries|Where{$_.FullName -eq 'xl/sharedStrings.xml'}; $s=$e.Open(); $r=[IO.StreamReader]::new($s); $r.ReadToEnd()"`;
    case 'pdf':
      return `powershell -c "Get-Content '${escaped}' -Raw | Select-String -Pattern '[\\w\\s]{4,}' -AllMatches | ForEach{\$_.Matches.Value}"`;
    case 'database':
      return `python -c "import sqlite3; conn=sqlite3.connect('${escaped}'); print([r[0] for r in conn.execute(\\\"SELECT name FROM sqlite_master WHERE type='table'\\\")]); [print(t[0], conn.execute(f'SELECT * FROM {t[0]}').fetchall()) for t in conn.execute(\\\"SELECT name FROM sqlite_master WHERE type='table'\\\")]"`;
    default:
      return null;
  }
}

export async function understandFile(
  path: string,
  toolDispatch: (name: string, args: Record<string, unknown>) => Promise<string>,
  options?: { visionAvailable?: boolean; ocrAvailable?: boolean }
): Promise<FileUnderstanding> {
  const category = categorizeFile(path);

  if (category === 'text' || category === 'code' || category === 'markup') {
    try {
      const content = await toolDispatch('fs_read', { path });
      return {
        path,
        category,
        extractedContent: content,
        method: 'direct-read',
        confidence: 1.0,
      };
    } catch (err: any) {
      return {
        path,
        category,
        extractedContent: null,
        method: 'direct-read',
        confidence: 0,
        error: String(err),
      };
    }
  }

  if (category === 'image') {
    if (options?.visionAvailable) {
      return {
        path,
        category,
        extractedContent: '[Image attached — vision model will process image pixels directly]',
        method: 'vision',
        confidence: 0.95,
      };
    }
    if (options?.ocrAvailable) {
      try {
        const ocrScript = `tesseract "${path.replace(/\\/g, '/')}" stdout`;
        const ocrOutput = await toolDispatch('shell_exec', { command: ocrScript });
        return {
          path,
          category,
          extractedContent: ocrOutput,
          method: 'ocr',
          confidence: 0.8,
        };
      } catch (err: any) {
        return {
          path,
          category,
          extractedContent: null,
          method: 'ocr',
          confidence: 0,
          error: `OCR execution failed: ${String(err)}`,
        };
      }
    }
    return {
      path,
      category,
      extractedContent: null,
      method: 'unsupported',
      confidence: 0,
      error: 'Image understanding requires a vision model or installed OCR engine (Tesseract).',
    };
  }

  const primaryScript = getExtractionScript(category, path);
  if (primaryScript) {
    try {
      const output = await toolDispatch('shell_exec', { command: primaryScript });
      if (output && !output.includes('ModuleNotFoundError') && !output.includes('Error')) {
        return {
          path,
          category,
          extractedContent: output,
          method: 'python-extraction',
          confidence: 0.9,
        };
      }
    } catch {}
  }

  const fallbackScript = getFallbackExtractionScript(category, path);
  if (fallbackScript) {
    try {
      const output = await toolDispatch('shell_exec', { command: fallbackScript });
      if (output && !output.includes('Error')) {
        return {
          path,
          category,
          extractedContent: output,
          method: 'shell-extraction',
          confidence: 0.9,
        };
      }
    } catch {}
  }

  return {
    path,
    category,
    extractedContent: null,
    method: 'unsupported',
    confidence: 0,
    error: `Unable to extract content from ${category} file. Install required Python packages (python-docx, openpyxl, python-pptx, PyPDF2) for native document extraction.`,
  };
}

export function getCapabilityReport(): string {
  return `## File Understanding Capabilities Registry
| File Type | Category | Extraction Method | Status |
|---|---|---|---|
| .txt, .md, .csv, .json | Text | \`fs_read\` | ✅ Native |
| .py, .ts, .js, .cpp, .rs | Code | \`fs_read\` | ✅ Native |
| .html, .css, .svg | Markup | \`fs_read\` | ✅ Native |
| .docx, .doc | Word | \`python-docx\` / ZIP XML | ⚠️ Requires Python / PowerShell Fallback |
| .xlsx, .xls | Excel | \`openpyxl\` / ZIP XML | ⚠️ Requires Python / PowerShell Fallback |
| .pptx, .ppt | PowerPoint | \`python-pptx\` | ⚠️ Requires Python |
| .pdf | PDF | \`PyPDF2\` / PowerShell | ⚠️ Requires Python / PowerShell Fallback |
| .png, .jpg, .webp | Image | Vision Model / Tesseract OCR | ⚠️ Capability-Gated |
| .zip, .tar.gz | Archive | \`Expand-Archive\` | ✅ Native PowerShell |
| .sqlite, .db | Database | \`sqlite3\` CLI | ✅ System SQLite |
`;
}
