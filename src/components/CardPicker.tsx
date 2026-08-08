import { useState, useRef, useCallback } from 'react'
import { ALL_RANKS, CARD_POINTS, calculateHandScore } from '../utils/scoring'
import type { CardRank } from '../types'
import { Minus, Plus, Check, Camera, RefreshCw, Loader, AlertCircle } from 'lucide-react'

interface CardPickerProps {
  playerName: string
  onConfirm: (score: number, cards: { rank: CardRank; count: number }[]) => void
  onCancel: () => void
}

type Tab = 'camera' | 'manual'

// ── Google Cloud Vision card parser ─────────────────────────────────────────

const VISION_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY // same project key

async function detectCardsFromImage(base64Image: string): Promise<Partial<Record<CardRank, number>>> {
  const body = {
    requests: [{
      image: { content: base64Image },
      features: [
        { type: 'TEXT_DETECTION', maxResults: 50 },
        { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
      ],
    }],
  }

  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )

  if (!resp.ok) throw new Error(`Vision API error: ${resp.status}`)
  const data = await resp.json()

  const textAnnotations: { description: string }[] =
    data.responses?.[0]?.textAnnotations ?? []

  // Build a single string of all detected text and scan for card ranks
  const allText = textAnnotations.map(a => a.description).join(' ').toUpperCase()

  const counts: Partial<Record<CardRank, number>> = {}

  const rankPatterns: { rank: CardRank; patterns: RegExp[] }[] = [
    { rank: 'Joker', patterns: [/JOKER/gi] },
    { rank: 'A',     patterns: [/\bA\b/g, /\bACE\b/gi] },
    { rank: 'K',     patterns: [/\bK\b/g, /\bKING\b/gi] },
    { rank: 'Q',     patterns: [/\bQ\b/g, /\bQUEEN\b/gi] },
    { rank: 'J',     patterns: [/\bJ\b/g, /\bJACK\b/gi] },
    { rank: '10',    patterns: [/\b10\b/g] },
    { rank: '9',     patterns: [/\b9\b/g] },
    { rank: '8',     patterns: [/\b8\b/g] },
    { rank: '7',     patterns: [/\b7\b/g] },
    { rank: '6',     patterns: [/\b6\b/g] },
    { rank: '5',     patterns: [/\b5\b/g] },
    { rank: '4',     patterns: [/\b4\b/g] },
    { rank: '3',     patterns: [/\b3\b/g] },
    { rank: '2',     patterns: [/\b2\b/g] },
  ]

  for (const { rank, patterns } of rankPatterns) {
    let total = 0
    for (const pat of patterns) {
      const matches = allText.match(pat)
      if (matches) total += matches.length
    }
    // Each card rank appears twice on a standard card (top + bottom corner)
    // Divide by 2 and round up to get card count
    if (total > 0) {
      counts[rank] = Math.max(1, Math.round(total / 2))
    }
  }

  return counts
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CardPicker({ playerName, onConfirm, onCancel }: CardPickerProps) {
  const [tab, setTab] = useState<Tab>('camera')
  const [counts, setCounts] = useState<Record<CardRank, number>>(() => {
    const init = {} as Record<CardRank, number>
    ALL_RANKS.forEach(r => { init[r] = 0 })
    return init
  })

  // Camera state
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiDone, setAiDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  const total = calculateHandScore(ALL_RANKS.map(r => ({ rank: r, count: counts[r] })))

  const adjust = (rank: CardRank, delta: number) => {
    setCounts(prev => ({ ...prev, [rank]: Math.max(0, prev[rank] + delta) }))
  }

  const handleConfirm = () => {
    const cards = ALL_RANKS.filter(r => counts[r] > 0).map(r => ({ rank: r, count: counts[r] }))
    onConfirm(total, cards)
  }

  // ── Camera helpers ────────────────────────────────────────────────────────

  const openCamera = useCallback(async () => {
    setAiError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      setStream(s)
      setCameraOpen(true)
      // attach to video element after state update
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

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
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
  }

  const analyzeImage = async (dataUrl: string) => {
    setAnalyzing(true)
    setAiError('')
    setAiDone(false)
    try {
      // Strip the data:image/...;base64, prefix
      const base64 = dataUrl.split(',')[1]
      const detected = await detectCardsFromImage(base64)

      if (Object.keys(detected).length === 0) {
        setAiError('No cards detected. Please adjust the counts manually.')
      } else {
        setCounts(prev => {
          const next = { ...prev }
          ALL_RANKS.forEach(r => { next[r] = 0 })
          Object.entries(detected).forEach(([rank, count]) => {
            next[rank as CardRank] = count ?? 0
          })
          return next
        })
        setAiDone(true)
        setTab('manual') // switch to manual tab so user can review/adjust
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setAiError(`AI detection failed: ${msg}. Adjust cards manually.`)
      setTab('manual')
    } finally {
      setAnalyzing(false)
    }
  }

  const resetCapture = () => {
    setCapturedImage(null)
    setAiDone(false)
    setAiError('')
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
          <div className="text-right">
            <div className="text-2xl font-bold text-brand-700">{total}</div>
            <div className="text-xs text-gray-400">points</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab('camera')}
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
              tab === 'camera' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500'
            }`}
          >
            <Camera size={15} /> Photo
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
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
                </div>
              )}

              {!analyzing && capturedImage && (
                <div className="space-y-3">
                  <img src={capturedImage} alt="Captured" className="w-full rounded-xl object-cover max-h-56" />
                  {aiDone && (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 flex items-center gap-2">
                      <Check size={15} />
                      Cards detected! Review &amp; adjust in the Manual tab.
                    </div>
                  )}
                  {aiError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 flex items-center gap-2">
                      <AlertCircle size={15} />
                      {aiError}
                    </div>
                  )}
                  <button onClick={resetCapture} className="btn-secondary w-full gap-2">
                    <RefreshCw size={15} /> Retake photo
                  </button>
                </div>
              )}

              {!analyzing && !capturedImage && (
                <div className="space-y-3">
                  {aiError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 flex items-center gap-2">
                      <AlertCircle size={15} />
                      {aiError}
                    </div>
                  )}

                  {/* Live camera preview */}
                  {cameraOpen && (
                    <div className="relative rounded-xl overflow-hidden bg-black">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full max-h-56 object-cover"
                      />
                      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-3">
                        <button
                          onClick={captureFromCamera}
                          className="w-14 h-14 rounded-full bg-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
                        >
                          <div className="w-11 h-11 rounded-full bg-brand-600" />
                        </button>
                      </div>
                      <button
                        onClick={closeCamera}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center text-lg font-bold"
                      >×</button>
                    </div>
                  )}

                  {!cameraOpen && (
                    <>
                      <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center space-y-2">
                        <Camera size={36} className="mx-auto text-gray-300" />
                        <p className="text-sm text-gray-500">Take a photo of the player's remaining cards</p>
                        <p className="text-xs text-gray-400">AI will detect the cards and calculate points</p>
                      </div>
                      <button onClick={openCamera} className="btn-primary w-full py-3 gap-2">
                        <Camera size={17} /> Open Camera
                      </button>
                      <div className="flex items-center gap-3">
                        <hr className="flex-1 border-gray-200" />
                        <span className="text-xs text-gray-400">or</span>
                        <hr className="flex-1 border-gray-200" />
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-secondary w-full gap-2"
                      >
                        Upload from gallery
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
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
                  AI pre-filled the counts — review and adjust if needed.
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
                    <span className={`w-6 text-center font-semibold ${counts[rank] > 0 ? 'text-brand-700' : 'text-gray-900'}`}>
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 safe-bottom">
          <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary flex-1 gap-2">
            <Check size={16} />
            Confirm {total} pts
          </button>
        </div>
      </div>
    </div>
  )
}
