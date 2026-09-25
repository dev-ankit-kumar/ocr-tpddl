import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from '../components/Alert'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/Button'
import { EditableTable } from '../components/EditableTable'
import { CameraIcon, DownloadIcon, TableIcon, TextIcon } from '../components/icons'
import { PrivacyNote } from '../components/PrivacyNote'
import { RawTextEditor } from '../components/RawTextEditor'
import { SegmentedControl } from '../components/SegmentedControl'
import { Spinner } from '../components/Spinner'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { useTableEditor } from '../hooks/useTableEditor'
import { downloadExcel } from '../services/excelExport'
import { parseText } from '../services/parser'
import type { ExtractionResult, ParseResult, SplitMode } from '../types'

type Tab = 'table' | 'text'

interface ResultsPageProps {
  result: ExtractionResult
  image: Blob | null
  onScanAgain: () => void
}

export function ResultsPage({ result, image, onScanAgain }: ResultsPageProps) {
  const editor = useTableEditor(result.parse.table)
  const { table } = editor
  const [parseInfo, setParseInfo] = useState<ParseResult>(result.parse)
  const [rawText, setRawText] = useState(result.ocr.text)
  const [splitMode, setSplitMode] = useState<SplitMode>('auto')
  // Unstructured results open on the raw text so the user can shape the data first.
  const [tab, setTab] = useState<Tab>(result.parse.structured ? 'table' : 'text')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const [showPhoto, setShowPhoto] = useState(false)
  const imageUrl = useObjectUrl(image)
  const initialTable = useRef(result.parse.table)

  const uncertainCount = useMemo(() => table.rows.flat().filter((c) => c.uncertain).length, [table])
  const hasData = table.rows.some((r) => r.some((c) => c.value.trim()))

  // Warn before closing the tab once the user has edited anything.
  useEffect(() => {
    if (table === initialTable.current && rawText === result.ocr.text) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [table, rawText, result.ocr.text])

  const convertText = () => {
    const parsed = parseText(rawText, splitMode)
    editor.replace(parsed.table)
    setParseInfo(parsed)
    setTab('table')
  }

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      setSavedAs(await downloadExcel(table, rawText))
    } catch (err) {
      console.error(err)
      setDownloadError('The Excel file could not be created. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  const ocrConfidence = Math.round(result.ocr.confidence)

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        title="Review & edit"
        onBack={onScanAgain}
        actions={
          // Mobile uses the bottom action bar instead.
          <div className="hidden sm:block">
            <Button size="sm" icon={downloading ? <Spinner className="size-4" /> : <DownloadIcon />} onClick={handleDownload} disabled={downloading || !hasData}>
              Download Excel
            </Button>
          </div>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-3 pt-4 pb-28 sm:px-4 sm:pb-8">
        {parseInfo.structured ? (
          <Alert tone="info" title="Please double-check the data">
            {parseInfo.description} OCR isn't perfect
            {uncertainCount > 0 && (
              <>
                {' '}– <mark className="rounded bg-amber-100 px-1 text-amber-900">{uncertainCount} highlighted cells</mark> had low recognition
                confidence
              </>
            )}
            .
          </Alert>
        ) : (
          <Alert tone="warning" title="No clear table detected">
            We couldn't confidently find rows and columns. Edit the text under <strong>Raw text</strong>, choose how columns are
            separated, then tap <strong>Convert to table</strong>. You can also edit the table directly.
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<Tab>
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'table', label: 'Table', icon: <TableIcon /> },
              { value: 'text', label: 'Raw text', icon: <TextIcon /> },
            ]}
          />
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>
              {table.rows.length} rows · {table.headers.length} cols · OCR confidence {ocrConfidence}%
            </span>
            {imageUrl && (
              <button type="button" onClick={() => setShowPhoto((s) => !s)} className="font-semibold text-brand-700 hover:underline">
                {showPhoto ? 'Hide photo' : 'Show photo'}
              </button>
            )}
          </div>
        </div>

        {showPhoto && imageUrl && (
          <img src={imageUrl} alt="Original document" className="max-h-80 w-full rounded-2xl bg-slate-200 object-contain ring-1 ring-slate-200" />
        )}

        {tab === 'table' ? (
          <EditableTable editor={editor} />
        ) : (
          <RawTextEditor
            text={rawText}
            splitMode={splitMode}
            onTextChange={setRawText}
            onSplitModeChange={setSplitMode}
            onConvert={convertText}
          />
        )}

        {downloadError && <Alert tone="error">{downloadError}</Alert>}
        {savedAs && !downloadError && (
          <Alert tone="info">
            Saved <strong>{savedAs}</strong> to your downloads.
          </Alert>
        )}

        <div className="hidden justify-between sm:flex">
          <Button variant="secondary" icon={<CameraIcon />} onClick={onScanAgain}>
            Scan Again
          </Button>
          <PrivacyNote className="max-w-sm" />
        </div>
      </main>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-3 backdrop-blur safe-bottom sm:hidden">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button variant="secondary" size="lg" icon={<CameraIcon />} onClick={onScanAgain}>
            Scan Again
          </Button>
          <Button size="lg" icon={downloading ? <Spinner className="size-5" /> : <DownloadIcon />} onClick={handleDownload} disabled={downloading || !hasData}>
            Download Excel
          </Button>
        </div>
      </div>
    </div>
  )
}
