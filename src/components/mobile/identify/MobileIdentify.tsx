'use client';

/**
 * Mobile "Identify by photo" — camera-first product identify for receiving /
 * local-pickup intake. Snap the printed label → the LAN vision box OCRs the Bose
 * model → the server resolves it to a catalog SKU → operator confirms → the line
 * is added to the carton. Built for rapid one-handed intake (camera re-arms after
 * each add). See docs/visual-receiving-identify-plan.md.
 *
 * Reliability model (industry standard): exact-first, human-confirmed. The label
 * OCR is the trusted signal; we show the text it read + never silent-commit — the
 * operator taps Add. No-label / not-in-catalog both degrade to clear next actions.
 *
 * URL params: ?recvId=<receiving id>&po=<human PO ref>. Without recvId the page
 * still identifies (read-only) but Add is disabled with a hint.
 *
 * Thin composition shell: camera + identify + live-scan logic lives in
 * {@link useMobileIdentify}; the candidate card + session list are presentational
 * components under `./`.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Check, X, RotateCcw, Loader2, AlertTriangle, Search, Zap } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { RETICLE_TINT } from './mobile-identify-shared';
import { useMobileIdentify } from './useMobileIdentify';
import { CandidateCard } from './CandidateCard';
import { SessionList } from './SessionList';

export function MobileIdentify() {
  const c = useMobileIdentify();
  const {
    recvId, poRef, videoRef, canvasRef, cameraError,
    frozen, added, adding, confirmed, isLive, switchMode, liveScan,
    status, candidates, rawText, error,
    capture, retake, confirm, createSkuAndAdd, flagMissing,
    liveScanning, manualIdle, reading,
  } = c;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#0B0B0F] text-white">
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => history.back()}
          icon={<X className="h-5 w-5" />}
          className="h-auto gap-1 px-0 text-sm text-white/70"
        >
          Identify
        </Button>

        {/* Live / Manual capture toggle */}
        <div className="flex items-center rounded-full bg-white/10 p-0.5 text-xs font-medium">
          {/* ds-raw-button: dark-theme segmented camera-mode toggle with custom emerald/white active states */}
          <button
            onClick={() => switchMode('live')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${isLive ? 'bg-emerald-500 text-black' : 'text-white/70'}`}
          >
            <Zap className="h-3.5 w-3.5" /> Live
          </button>
          {/* ds-raw-button: dark-theme segmented camera-mode toggle with custom emerald/white active states */}
          <button
            onClick={() => switchMode('manual')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${!isLive ? 'bg-surface-card text-black' : 'text-white/70'}`}
          >
            <Camera className="h-3.5 w-3.5" /> Manual
          </button>
        </div>

        {poRef ? (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium tabular-nums">PO {poRef}</span>
        ) : recvId ? (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">Carton #{recvId}</span>
        ) : (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs text-amber-300">view-only</span>
        )}
      </div>

      {/* Viewfinder (live) or freeze-frame */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${frozen ? 'opacity-0' : 'opacity-100'}`}
        />
        {frozen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozen} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Manual aim reticle (manual mode, waiting for shutter) */}
      {manualIdle && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
          <motion.div
            initial={{ opacity: 0.5 }}
            animate={{ opacity: [0.5, 0.9, 0.5] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
            className="h-44 w-72 rounded-2xl border-2 border-dashed border-white/70"
          />
          <p className="mt-4 text-sm text-white/80">Aim at the printed label on the bottom</p>
        </div>
      )}

      {/* Live reticle — border tints by frame quality; green = good enough to read */}
      {liveScanning && !frozen && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
          <motion.div
            animate={{ scale: liveScan.gateReason === 'ok' ? [1, 1.02, 1] : 1 }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
            className={`h-44 w-72 rounded-2xl border-2 transition-colors ${RETICLE_TINT[liveScan.gateReason]}`}
          />
          <p className="mt-4 flex items-center gap-1.5 text-sm text-white/80">
            <Zap className="h-4 w-4 text-emerald-400" /> {liveScan.hint || 'Aim at the printed label'}
          </p>
        </div>
      )}

      {/* Reading scan-line (manual identify or live read in flight) */}
      {reading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
          <motion.div
            initial={{ y: -90 }}
            animate={{ y: 90 }}
            transition={{ repeat: Infinity, repeatType: 'reverse', duration: 0.9, ease: 'easeInOut' }}
            className="h-0.5 w-72 bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.7)]"
          />
          <span className="absolute bottom-32 flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading label…
          </span>
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-xl bg-white/10 p-4 text-center text-sm text-white/80">
          Camera unavailable ({cameraError}). Check permissions, then reload.
        </div>
      )}

      {/* Manual shutter */}
      {manualIdle && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {added.length > 0 && <SessionList added={added} />}
          {/* ds-raw-button: circular camera shutter (no icon/label), not a DS Button */}
          <button
            onClick={() => void capture()}
            aria-label="Capture"
            className="h-[72px] w-[72px] rounded-full border-4 border-white/80 bg-surface-card/95 shadow-lg active:scale-95"
          />
        </div>
      )}

      {/* Live mode bottom bar — session list + hands-free indicator (no shutter) */}
      {isLive && !frozen && (liveScan.phase === 'scanning' || liveScan.phase === 'reading' || liveScan.phase === 'idle') && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {added.length > 0 && <SessionList added={added} />}
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs text-white/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Scanning — hold the label in view
          </div>
        </div>
      )}

      {/* Confirmed success sheet — shown after Add, before the camera re-arms. */}
      <AnimatePresence>
        {confirmed && (
          <motion.div
            key="confirmed"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-[#15151B] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <div className="space-y-4 text-center">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500"
              >
                <Check className="h-8 w-8 text-black" />
              </motion.div>
              <div>
                <div className="text-base font-semibold">{confirmed.title}</div>
                <div className="mt-0.5 text-sm text-white/50">
                  Added to {poRef ? `PO ${poRef}` : `carton #${recvId}`}
                  {added.length > 1 ? ` · ${added.length} this session` : ''}
                </div>
              </div>
              <Button
                variant="ghost"
                size="lg"
                onClick={retake}
                className="h-auto w-full rounded-xl bg-surface-card py-3.5 text-sm font-semibold text-black active:scale-[0.99]"
              >
                Next item
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result / no-match sheet (hidden once a candidate is confirmed) */}
      <AnimatePresence>
        {!confirmed && (status === 'results' || status === 'error') && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl bg-[#15151B] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />

            {status === 'error' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-amber-300">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={retake}
                    className="h-auto flex-1 rounded-xl bg-surface-card py-3 text-sm font-semibold text-black"
                  >
                    Retake
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => recvId && (window.location.href = `/m/receive/${recvId}`)}
                    icon={<Search className="h-4 w-4" />}
                    className="h-auto gap-1.5 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white/80"
                  >
                    Search
                  </Button>
                </div>
              </div>
            )}

            {status === 'results' && (
              <div className="space-y-2">
                <div className="px-1 text-xs font-medium uppercase tracking-wide text-white/40">
                  Confirm the product
                </div>
                {candidates.map((cand, i) => (
                  <CandidateCard
                    key={`${cand.model}-${i}`}
                    c={cand}
                    primary={i === 0}
                    adding={adding}
                    canAdd={!!recvId}
                    onAdd={confirm}
                    onCreateSku={createSkuAndAdd}
                    onFlagMissing={flagMissing}
                  />
                ))}
                {rawText && (
                  <p className="px-1 pt-1 text-caption text-white/30">read: “{rawText.slice(0, 90)}”</p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={retake}
                  icon={<RotateCcw className="h-3 w-3" />}
                  className="mt-1 h-auto gap-1.5 px-1 text-xs text-white/50"
                >
                  Retake
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
