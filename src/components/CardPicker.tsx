import { useState, useRef, useCallback } from 'react'
import { ALL_RANKS, CARD_POINTS, calculateHandScore } from '../utils/scoring'
import type { CardRank } from '../types'
import { Minus, Plus, Check, Camera, RefreshCw, Loader, AlertCircle, Edit3 } from 'lucide-react'

interface CardPickerProps {
  playerName: string
  onConfirm: (score: number, cards: { rank: CardRank; count: number }[]) => void
  onCancel: () => void
}

type Tab = 'camera' | 'manual'

// ── Google Cloud Vision card parser ─────────────────────────────────────────

const VISION_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY

// Each Vision annotation is a single text fragment (e.g. "A", "K", "10", "JOKER")
// We match each fragment individually to avoid false positives from concatenation
function parseCardsFromAnnotations(annotations: { description: string }[]): Partial<Record<CardRank, number>> {
  // Skip the first annotation — it's the full page text dump
  const fragments = annotations.slice(1).map(a => a.description.trim().toUpperCase())

  // Tally how many times each rank token appears
  const tally: Partial<Record<CardRank, number>> = {}

  const exactMap: Record<string, CardRank> = {
    'A': 'A', 'ACE': 'A',
    'K': 'K', 'KING': 'K',
    'Q': 'Q', 'QUEEN': 'Q',
    'J': 'J', 'JACK': 'J',
    '10': '10',
    '9': '9', '8': '8', '7': '7', '6': '6',
    '5': '5', '4': '4', '3': '3', '2': '2',
    'JOKER': 'Joker', 'JKR': 'Joker',
  }

  for (const fragment of fragments) {
    const rank = exactMap[fragment]
    if (rank) {
      tally[rank] = (tally[rank] ?? 0) + 1
    }
  }

  // Standard playing cards show the rank in TWO corners (top-left + bottom-right)
  // When cards are spread out face-up, Vision often sees each corner separately.
  // Divide by 2, minimum 1. If only 1 detection, still count as 1 card.
  const counts: Partial<Record<CardRank, number>> = {}
  for (const [rank, n] of Object.entries(tally) as [CardRank, number][]) {
    counts[rank] = Math.max(1, Math.round(n / 2))
  }

  return counts
}

async function detectCardsFromImage(base64Image: string): Promise<{
  counts: Partial<Record<CardRank, number>>
  rawText: string
  error?: string
}> {
  const body = {
    requests: [{
      image: { content: base64Image },
      features: [
        { type: 'TEXT_DETECTION', maxResults: 100 },
      ],
    }],
  }

  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )

  const data = await resp.json()

  // Surface any API-level error
  if (!resp.ok) {
    const msg = data?.error?.message ?? `HTTP ${resp.status}`
    return { counts: {}, rawText: '', error: msg }
  }

  const response = data.responses?.[0]
  if (response?.error) {
    return { counts: {}, rawText: '', error: response.error.message }
  }

  const annotations: { description: string }[] = response?.textAnnotations ?? []
  if (annotations.length === 0) {
    return { counts: {}, rawText: '', error: 'No text found in image. Make sure cards are well-lit and clearly visible.' }
  }

  const rawText = annotations[0]?.description ?? ''
  const counts = parseCardsFromAnnotations(annotations)

  return { counts, rawText }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CardPicker({ playerName, onConfirm, onCancel }: CardPickerProps) {
  const [tab, setTab] = useState<Tab>('camera')
  const [counts, setCounts] = useState<Record<CardRank, number>>(() => {
    const init = {} as Record<CardRank, number>
    ALL_RANKS.forEach(r => { init[r] = 0 })
    return init
  })

  // Manual total override
  const [manualTotal, setManualTotal] = useState<number | null>(null)
  const [editingTotal, setEditingTotal] = useState(false)
  const [totalInput, setTotalInput] = useState('')

  // Camera state
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiDone, setAiDone] = useState(false)
  const [rawDetected, setRawDetected] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  const computedTotal = calculateHandScore(ALL_RANKS.map(r => ({ rank: r, count: counts[r] })))
  const displayTotal = manualTotal !== null ? manualTotal : computedTotal

  const adjust = (rank: CardRank, delta: number) => {
    setManualTotal(null) // reset manual override when cards change
    setCounts(prev => ({ ...prev, [rank]: Math.max(0, prev[rank] + delta) }))
  }

  // Manual total edit
  const startEditTotal = () => {
    setTotalInput(String(displayTotal))
    setEditingTotal(true)
  }
  const commitEditTotal = () => {
    const v = parseInt(totalInput, 10)
    if (!isNaN(v) && v >= 0) setManualTotal(v)
    setEditingTotal(false)
  }

  const handleConfirm = () => {
    const cards = ALL_RANKS.filter(r => counts[r] > 0).map(r => ({ rank: r, count: counts[r] }))
    onConfirm(displayTotal, cards)
  }

  // ── Camera helpers ────────────────────────────────────────────────────────

  const openCamera = useCallback(async () => {
    setAiError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      setStream(s)
      setCameraOpen(true)
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = s
      }, 100)
    } catch {
      setAiError('Camera not accessible. Use the upload button instead.')
    }
  }, [])

  const closeCamera = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setCameraOpen(false)
  }, [stream])

  // Resize + compress to max 1024px wide, 60% JPEG quality
  // iOS camera images can be 4–8 MB which causes Safari fetch to abort
  const compressImage = (dataUrl: string): Promise<string> =>
    new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const MAX = 1024
        const scale = img.width > MAX ? MAX / img.width : 1
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.6))
      }
      img.src = dataUrl
    })

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth  || 1280
    canvas.height = videoRef.current.videoHeight || 720
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedImage(dataUrl)
    closeCamera()
    analyzeImage(dataUrl)
  }, [closeCamera])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setCapturedImage(dataUrl)
      analyzeImage(dataUrl)
    }
    reader.readAsDataURL(file)
    // reset input so same file can be re-uploaded
    e.target.value = ''
  }

  const analyzeImage = async (dataUrl: string) => {
    setAnalyzing(true)
    setAiError('')
    setAiDone(false)
    setRawDetected('')
    setManualTotal(null)
    try {
      const compressed = await compressImage(dataUrl)
      const base64 = compressed.split(',')[1]
      const { counts: detected, rawText, error } = await detectCardsFromImage(base64)

      setRawDetected(rawText)

      if (error) {
        setAiError(error)
        setTab('manual')
        return
      }

      if (Object.keys(detected).length === 0) {
        setAiError('No cards detected. Try again with better lighting, or adjust manually.')
        setTab('manual')
        return
      }

      setCounts(prev => {
        const next = { ...prev }
        ALL_RANKS.forEach(r => { next[r] = 0 })
        Object.entries(detected).forEach(([rank, count]) => {
          next[rank as CardRank] = count ?? 0
        })
        return next
      })
      setAiDone(true)
      setTab('manual')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setAiError(`Detection failed: ${msg}`)
      setTab('manual')
    } finally {
      setAnalyzing(false)
    }
  }

  const resetCapture = () => {
    setCapturedImage(null)
    setAiDone(false)
    setAiError('')
    setRawDetected('')
    setManualTotal(null)
    setCounts(() => {
      const init = {} as Record<CardRank, number>
      ALL_RANKS.forEach(r => { init[r] = 0 })
      return init
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-base text-gray-900">Remaining cards</h3>
            <p className="text-sm text-gray-500 mt-0.5">{playerName}</p>
          </div>
          {/* Total — tappable to edit manually */}
          <div className="text-right">
            {editingTotal ? (
              <div className="flex items-center gap-1 justify-end">
                <input
                  type="number"
                  value={totalInput}
                  min={0}
                  onChange={e => setTotalInput(e.target.value)}
                  onBlur={commitEditTotal}
                  onKeyDown={e => { if (e.key === 'Enter') commitEditTotal() }}
                  className="w-20 text-right text-2xl font-bold text-brand-700 border-b-2 border-brand-500 outline-none bg-transparent"
                  autoFocus
                />
                <button onClick={commitEditTotal} className="text-brand-600 p-1">
                  <Check size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={startEditTotal}
                className="flex items-center gap-1 group"
                title="Tap to override total"
              >
                <div>
                  <div className="text-2xl font-bold text-brand-700 leading-none">{displayTotal}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1 justify-end mt-0.5">
                    pts <Edit3 size={10} className="opacity-50 group-hover:opacity-100" />
                  </div>
                </div>
              </button>
            )}
            {manualTotal !== null && (
              <button
                onClick={() => setManualTotal(null)}
                className="text-xs text-brand-500 underline mt-0.5 block text-right"
              >
                reset to cards
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab('camera')}
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'camera' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500'
            }`}
          >
            <Camera size={15} /> Photo
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'manual' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500'
            }`}
          >
            <Plus size={15} /> Manual
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── CAMERA TAB ── */}
          {tab === 'camera' && (
            <div className="p-5 space-y-4">

              {analyzing && (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-brand-600">
                  <Loader size={36} className="animate-spin" />
                  <p className="text-sm font-medium">Analysing cards with AI…</p>
                  <p className="text-xs text-gray-400">This takes a few seconds</p>
                </div>
              )}

              {!analyzing && capturedImage && (
                <div className="space-y-3">
                  <img src={capturedImage} alt="Captured" className="w-full rounded-xl object-cover max-h-52" />
                  {aiDone && (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 flex items-center gap-2">
                      <Check size={15} />
                      Cards detected! Switch to Manual tab to review &amp; adjust.
                    </div>
                  )}
                  {aiError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 flex items-start gap-2">
                      <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <p>{aiError}</p>
                        {rawDetected && (
                          <details className="mt-1">
                            <summary className="text-xs cursor-pointer text-amber-600">Show raw detected text</summary>
                            <pre className="text-xs mt-1 whitespace-pre-wrap break-all text-gray-600">{rawDetected}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={resetCapture} className="btn-secondary flex-1 gap-1.5">
                      <RefreshCw size={14} /> Retake
                    </button>
                    <button onClick={() => setTab('manual')} className="btn-primary flex-1 gap-1.5">
                      <Plus size={14} /> Adjust manually
                    </button>
                  </div>
                </div>
              )}

              {!analyzing && !capturedImage && (
                <div className="space-y-3">
                  {aiError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 flex items-center gap-2">
                      <AlertCircle size={15} /> {aiError}
                    </div>
                  )}

                  {cameraOpen && (
                    <div className="relative rounded-xl overflow-hidden bg-black">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-64 object-cover" />
                      <p className="absolute top-2 left-0 right-0 text-center text-xs text-white/80 bg-black/30 py-1">
                        Spread cards face-up · good lighting helps
                      </p>
                      <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                        <button
                          onClick={captureFromCamera}
                          className="w-16 h-16 rounded-full bg-white shadow-xl flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <div className="w-12 h-12 rounded-full bg-brand-600" />
                        </button>
                      </div>
                      <button
                        onClick={closeCamera}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center font-bold text-lg leading-none"
                      >×</button>
                    </div>
                  )}

                  {!cameraOpen && (
                    <>
                      <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center space-y-2">
                        <Camera size={40} className="mx-auto text-gray-300" />
                        <p className="text-sm font-medium text-gray-600">Photograph the player's remaining cards</p>
                        <p className="text-xs text-gray-400">Spread them face-up, good lighting. AI reads the rank from each corner.</p>
                      </div>
                      <button onClick={openCamera} className="btn-primary w-full py-3 gap-2 text-base">
                        <Camera size={18} /> Open Camera
                      </button>
                      <div className="flex items-center gap-3">
                        <hr className="flex-1 border-gray-200" />
                        <span className="text-xs text-gray-400">or upload a photo</span>
                        <hr className="flex-1 border-gray-200" />
                      </div>
                      <button onClick={() => fileInputRef.current?.click()} className="btn-secondary w-full gap-2">
                        Choose from gallery
                      </button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── MANUAL TAB ── */}
          {tab === 'manual' && (
            <div className="px-5 py-3 space-y-1">
              {aiDone && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-blue-700 flex items-center gap-2 mb-2">
                  <Check size={14} />
                  AI pre-filled — review and adjust if needed.
                </div>
              )}
              {ALL_RANKS.map(rank => (
                <div key={rank} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-3">
                    <span className="w-10 text-center font-mono font-bold text-gray-800 text-base">{rank}</span>
                    <span className="text-sm text-gray-400">
                      {CARD_POINTS[rank]} pt{CARD_POINTS[rank] > 1 ? 's' : ''} each
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => adjust(rank, -1)}
                      disabled={counts[rank] === 0}
                      className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-30 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className={`w-6 text-center font-semibold ${counts[rank] > 0 ? 'text-brand-700' : 'text-gray-400'}`}>
                      {counts[rank]}
                    </span>
                    <button
                      onClick={() => adjust(rank, 1)}
                      className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Direct total override hint */}
              <div className="pt-3 pb-1 border-t border-gray-100 text-center">
                <p className="text-xs text-gray-400">
                  Tap the score in the top-right to override the total directly.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 safe-bottom">
          <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary flex-1 gap-2">
            <Check size={16} />
            Confirm {displayTotal} pts
          </button>
        </div>
      </div>
    </div>
  )
}
