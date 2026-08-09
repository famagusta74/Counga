import { useState, useRef, useCallback } from 'react'
import type { CardRank } from '../types'
import { Camera, Check, RefreshCw, Loader, AlertCircle } from 'lucide-react'

interface CardPickerProps {
  playerName: string
  onConfirm: (score: number, cards: { rank: CardRank; count: number }[]) => void
  onCancel: () => void
}

// ── Google Cloud Vision ───────────────────────────────────────────────────────

const VISION_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY

const CARD_POINTS: Record<string, number> = {
  'A': 11, 'ACE': 11,
  'K': 10, 'KING': 10,
  'Q': 10, 'QUEEN': 10,
  'J': 10, 'JACK': 10,
  '10': 10, '9': 9, '8': 8, '7': 7,
  '6': 6,  '5': 5, '4': 4, '3': 3, '2': 2,
  'JOKER': 25, 'JKR': 25,
}

function parseScoreFromAnnotations(annotations: { description: string }[]): number {
  const fragments = annotations.slice(1).map(a => a.description.trim().toUpperCase())
  let total = 0
  const tally: Record<string, number> = {}
  for (const f of fragments) {
    if (CARD_POINTS[f] !== undefined) {
      tally[f] = (tally[f] ?? 0) + 1
    }
  }
  for (const [token, count] of Object.entries(tally)) {
    // Each card corner appears twice — divide by 2, min 1
    const cards = Math.max(1, Math.round(count / 2))
    total += (CARD_POINTS[token] ?? 0) * cards
  }
  return total
}

async function scoreFromImage(base64: string): Promise<{ score: number; error?: string }> {
  const body = {
    requests: [{
      image: { content: base64 },
      features: [{ type: 'TEXT_DETECTION', maxResults: 100 }],
    }],
  }
  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  const data = await resp.json()
  if (!resp.ok) return { score: 0, error: data?.error?.message ?? `HTTP ${resp.status}` }
  const response = data.responses?.[0]
  if (response?.error) return { score: 0, error: response.error.message }
  const annotations: { description: string }[] = response?.textAnnotations ?? []
  if (annotations.length === 0) return { score: 0, error: 'No cards detected in photo. Enter score manually.' }
  return { score: parseScoreFromAnnotations(annotations) }
}

function compressImage(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
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
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CardPicker({ playerName, onConfirm, onCancel }: CardPickerProps) {
  const [points, setPoints]           = useState('')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [analyzing, setAnalyzing]     = useState(false)
  const [aiError, setAiError]         = useState('')
  const [cameraOpen, setCameraOpen]   = useState(false)
  const [stream, setStream]           = useState<MediaStream | null>(null)

  const videoRef    = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const score = parseInt(points, 10)
  const validScore = !isNaN(score) && score >= 0

  // ── Camera ──────────────────────────────────────────────────────────────────

  const openCamera = useCallback(async () => {
    setAiError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      setStream(s)
      setCameraOpen(true)
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s }, 100)
    } catch {
      setAiError('Camera not accessible. Upload a photo instead.')
    }
  }, [])

  const closeCamera = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setCameraOpen(false)
  }, [stream])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth  || 1280
    canvas.height = videoRef.current.videoHeight || 720
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    closeCamera()
    runAI(dataUrl)
  }, [closeCamera])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => runAI(ev.target?.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const runAI = async (dataUrl: string) => {
    setCapturedImage(dataUrl)
    setAnalyzing(true)
    setAiError('')
    setPoints('')
    try {
      const compressed = await compressImage(dataUrl)
      const base64 = compressed.split(',')[1]
      const { score: detected, error } = await scoreFromImage(base64)
      if (error) {
        setAiError(error)
      } else if (detected === 0) {
        setAiError('Could not detect any cards. Enter the score manually.')
      } else {
        setPoints(String(detected))
      }
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Detection failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const reset = () => {
    setCapturedImage(null)
    setAiError('')
    setPoints('')
  }

  const handleConfirm = () => {
    if (!validScore) return
    onConfirm(score, [])
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Sheet: max 90vh so footer is always visible, flex-col keeps footer pinned */}
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl flex flex-col"
           style={{ maxHeight: '90dvh' }}>

        {/* Header — fixed, never scrolls away */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Remaining cards</p>
          <h3 className="text-xl font-bold text-gray-900 mt-0.5">{playerName}</h3>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* ── Score input ──────────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Points</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={points}
              onChange={e => { setPoints(e.target.value); setCapturedImage(null); setAiError('') }}
              placeholder="Enter total points…"
              className="input text-3xl font-bold text-brand-700 text-center py-4 tracking-wide"
              autoFocus
            />
          </div>

          {/* ── Photo section ────────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Or scan with camera
            </label>

            {analyzing && (
              <div className="flex items-center justify-center gap-3 py-6 text-brand-600 bg-brand-50 rounded-2xl">
                <Loader size={22} className="animate-spin" />
                <span className="text-sm font-medium">Detecting cards…</span>
              </div>
            )}

            {!analyzing && capturedImage && (
              <div className="space-y-2">
                <div className="relative rounded-2xl overflow-hidden">
                  <img src={capturedImage} alt="Captured" className="w-full max-h-36 object-cover" />
                  {validScore && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-white text-4xl font-bold drop-shadow-lg">{score} pts</span>
                    </div>
                  )}
                </div>
                {aiError && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-700">
                    <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>{aiError}</span>
                  </div>
                )}
                <button onClick={reset} className="btn-secondary w-full gap-2 py-2">
                  <RefreshCw size={14} /> Retake / clear
                </button>
              </div>
            )}

            {!analyzing && !capturedImage && (
              <>
                {cameraOpen ? (
                  <div className="relative rounded-2xl overflow-hidden bg-black">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-44 object-cover" />
                    <p className="absolute top-2 left-0 right-0 text-center text-xs text-white/80 bg-black/30 py-1">
                      Spread cards face-up in good light
                    </p>
                    <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                      <button
                        onClick={capturePhoto}
                        className="w-14 h-14 rounded-full bg-white shadow-xl flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <div className="w-10 h-10 rounded-full bg-brand-600" />
                      </button>
                    </div>
                    <button
                      onClick={closeCamera}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center font-bold text-lg"
                    >×</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={openCamera} className="btn-secondary flex-1 py-3 gap-2">
                      <Camera size={17} /> Camera
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex-1 py-3 gap-2">
                      <Camera size={17} /> Gallery
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  </div>
                )}
                {aiError && !capturedImage && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-600 mt-2">
                    <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>{aiError}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer — pinned to bottom, never hidden */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 safe-bottom">
          <button onClick={onCancel} className="btn-secondary flex-1 py-3">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!validScore}
            className="btn-primary flex-1 py-3 text-base gap-2"
          >
            <Check size={17} />
            Confirm {validScore ? `${score} pts` : ''}
          </button>
        </div>

      </div>
    </div>
  )
}
