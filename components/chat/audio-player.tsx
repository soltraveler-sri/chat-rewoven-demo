"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Play, Pause, Volume2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface TTSStreamConfig {
  text: string
  /** Optional voice override; the server owns model/voice defaults */
  voice?: string
  /** Whether streaming should begin immediately on mount */
  autoStart?: boolean
}

interface AudioPlayerProps {
  /** URL to the audio blob (for non-streaming playback) */
  audioUrl?: string
  /** Streaming TTS config — player fetches and plays progressively via MediaSource */
  streamConfig?: TTSStreamConfig
  /** Document filename for display */
  filename?: string
  /** TTS voice used */
  voice?: string
  className?: string
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const

export function AudioPlayer({
  audioUrl,
  streamConfig,
  filename,
  voice,
  className,
}: AudioPlayerProps) {
  const shouldAutoStartStream = streamConfig?.autoStart !== false
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(1) // Default 1x
  const [isBuffering, setIsBuffering] = useState(!!streamConfig && shouldAutoStartStream)
  const [streamComplete, setStreamComplete] = useState(!streamConfig)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [bufferedTime, setBufferedTime] = useState(0)
  const [hasStreamStarted, setHasStreamStarted] = useState(!!streamConfig && shouldAutoStartStream)
  const progressRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mediaSourceUrlRef = useRef<string | null>(null)
  const streamInitiatedRef = useRef(false)

  const speed = SPEED_OPTIONS[speedIndex]
  const isStreamMode = !!streamConfig

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)
    const onDurationChange = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration)
    }
    const onEnded = () => setIsPlaying(false)
    const onWaiting = () => { if (isStreamMode) setIsBuffering(true) }
    const onPlaying = () => setIsBuffering(false)
    const onProgress = () => {
      if (audio.buffered.length > 0) {
        setBufferedTime(audio.buffered.end(audio.buffered.length - 1))
      }
    }

    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("durationchange", onDurationChange)
    audio.addEventListener("ended", onEnded)
    audio.addEventListener("waiting", onWaiting)
    audio.addEventListener("playing", onPlaying)
    audio.addEventListener("progress", onProgress)

    // Set src for non-streaming mode
    if (audioUrl && !isStreamMode) {
      audio.src = audioUrl
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("durationchange", onDurationChange)
      audio.removeEventListener("ended", onEnded)
      audio.removeEventListener("waiting", onWaiting)
      audio.removeEventListener("playing", onPlaying)
      audio.removeEventListener("progress", onProgress)
    }
  }, [audioUrl, isStreamMode])

  const beginStream = useCallback(() => {
    if (!streamConfig || audioUrl || streamInitiatedRef.current) return
    streamInitiatedRef.current = true
    setHasStreamStarted(true)
    setIsBuffering(true)
    setStreamError(null)

    const abortController = new AbortController()
    abortRef.current = abortController

    // Check MediaSource support for audio/mpeg
    const canUseMediaSource =
      typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported("audio/mpeg")

    const t0 = performance.now()
    console.log(`[TTS:telemetry] Stream init | path=${canUseMediaSource ? "MediaSource" : "fallback"} | textLen=${streamConfig.text.length}`)

    if (canUseMediaSource) {
      startMediaSourceStream(streamConfig, abortController.signal, t0)
    } else {
      startFallbackStream(streamConfig, abortController.signal, t0)
    }
  }, [audioUrl, streamConfig])

  // Streaming setup — auto-starts only for fresh read-aloud messages.
  useEffect(() => {
    if (shouldAutoStartStream) {
      beginStream()
    }
  }, [beginStream, shouldAutoStartStream])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (mediaSourceUrlRef.current) {
        URL.revokeObjectURL(mediaSourceUrlRef.current)
        mediaSourceUrlRef.current = null
      }
    }
  }, [])

  async function startMediaSourceStream(
    config: TTSStreamConfig,
    signal: AbortSignal,
    t0: number
  ) {
    try {
      const ms = new MediaSource()
      const msUrl = URL.createObjectURL(ms)
      mediaSourceUrlRef.current = msUrl

      const audio = audioRef.current
      if (audio) audio.src = msUrl

      // Wait for sourceopen
      await new Promise<void>((resolve) => {
        ms.addEventListener("sourceopen", () => resolve(), { once: true })
      })

      if (signal.aborted) return

      const sb = ms.addSourceBuffer("audio/mpeg")

      console.log(`[TTS:telemetry] MediaSource ready, sending fetch | +${Math.round(performance.now() - t0)}ms`)

      const res = await fetch("/api/doc/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: config.text,
          ...(config.voice ? { voice: config.voice } : {}),
        }),
        signal,
      })

      console.log(`[TTS:telemetry] Fetch response received (status ${res.status}) | +${Math.round(performance.now() - t0)}ms`)

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(
          (errData as { error?: string }).error || "TTS streaming failed"
        )
      }

      const reader = res.body.getReader()
      let firstChunkReceived = false
      let chunkCount = 0
      let totalBytes = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted) return

        chunkCount++
        totalBytes += value.byteLength
        console.log(`[TTS:telemetry] Chunk #${chunkCount} received | ${value.byteLength} bytes | total=${totalBytes} | +${Math.round(performance.now() - t0)}ms`)

        // Wait for sourceBuffer to finish any pending update
        if (sb.updating) {
          await new Promise<void>((resolve) => {
            sb.addEventListener("updateend", () => resolve(), { once: true })
          })
        }

        if (signal.aborted) return
        sb.appendBuffer(value)

        if (!firstChunkReceived) {
          firstChunkReceived = true
          setIsBuffering(false)
          console.log(`[TTS:telemetry] First chunk appended, attempting auto-play | +${Math.round(performance.now() - t0)}ms`)
          // Auto-play after first chunk arrives
          const a = audioRef.current
          if (a) {
            a.play()
              .then(() => {
                setIsPlaying(true)
                console.log(`[TTS:telemetry] Audio playback STARTED | +${Math.round(performance.now() - t0)}ms`)
              })
              .catch((playErr) => {
                setIsPlaying(false)
                console.warn(`[TTS:telemetry] Auto-play BLOCKED: ${playErr.message} | +${Math.round(performance.now() - t0)}ms`)
              })
          }
        }
      }

      // Wait for final buffer update
      if (sb.updating) {
        await new Promise<void>((resolve) => {
          sb.addEventListener("updateend", () => resolve(), { once: true })
        })
      }

      if (!signal.aborted && ms.readyState === "open") {
        ms.endOfStream()
      }
      setStreamComplete(true)
      console.log(`[TTS:telemetry] Stream COMPLETE | ${chunkCount} chunks | ${totalBytes} bytes | +${Math.round(performance.now() - t0)}ms`)
    } catch (err) {
      if (signal.aborted) return
      console.error(`[TTS:telemetry] MediaSource stream ERROR: ${err instanceof Error ? err.message : err} | +${Math.round(performance.now() - t0)}ms`)
      setStreamError(err instanceof Error ? err.message : "Streaming failed")
      setIsBuffering(false)
    }
  }

  async function startFallbackStream(
    config: TTSStreamConfig,
    signal: AbortSignal,
    t0: number
  ) {
    try {
      console.log(`[TTS:telemetry] Fallback: sending fetch | +${Math.round(performance.now() - t0)}ms`)

      const res = await fetch("/api/doc/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: config.text,
          ...(config.voice ? { voice: config.voice } : {}),
        }),
        signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(
          (errData as { error?: string }).error || "TTS generation failed"
        )
      }

      const blob = await res.blob()
      console.log(`[TTS:telemetry] Fallback: full blob received (${blob.size} bytes) | +${Math.round(performance.now() - t0)}ms`)
      if (signal.aborted) return

      const blobUrl = URL.createObjectURL(blob)
      const audio = audioRef.current
      if (audio) {
        audio.src = blobUrl
        audio.play()
          .then(() => {
            setIsPlaying(true)
            console.log(`[TTS:telemetry] Fallback: playback STARTED | +${Math.round(performance.now() - t0)}ms`)
          })
          .catch((playErr) => {
            setIsPlaying(false)
            console.warn(`[TTS:telemetry] Fallback: auto-play BLOCKED: ${playErr.message}`)
          })
      }
      setIsBuffering(false)
      setStreamComplete(true)
    } catch (err) {
      if (signal.aborted) return
      console.error(`[TTS:telemetry] Fallback ERROR: ${err instanceof Error ? err.message : err} | +${Math.round(performance.now() - t0)}ms`)
      setStreamError(err instanceof Error ? err.message : "TTS failed")
      setIsBuffering(false)
    }
  }

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isStreamMode && !streamInitiatedRef.current) {
      beginStream()
      return
    }

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }, [beginStream, isPlaying, isStreamMode])

  const cycleSpeed = useCallback(() => {
    const nextIndex = (speedIndex + 1) % SPEED_OPTIONS.length
    setSpeedIndex(nextIndex)
    const audio = audioRef.current
    if (audio) {
      audio.playbackRate = SPEED_OPTIONS[nextIndex]
    }
  }, [speedIndex])

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (bufferedTime / duration) * 100 : 0

  if (streamError) {
    return (
      <div
        className={cn(
          "p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive",
          className
        )}
      >
        Audio generation failed: {streamError}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 rounded-lg border-l-2 border-l-thread bg-surface-sunken",
        className
      )}
    >
      <audio ref={audioRef} preload="metadata" />

      {/* Header with filename and voice */}
      {(filename || voice) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          {filename && <span className="truncate">{filename}</span>}
          {voice && (
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium uppercase">
              {voice}
            </span>
          )}
          {isStreamMode && hasStreamStarted && !streamComplete && (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-[10px]">Streaming</span>
            </span>
          )}
        </div>
      )}

      {/* Controls row */}
      {isBuffering && isStreamMode ? (
        <div className="flex items-center gap-2 py-1">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
          <span className="text-xs text-muted-foreground">
            Preparing audio...
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* Play/Pause button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={togglePlay}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </Button>

          {/* Progress bar — no seek in stream mode until complete */}
          <div
            ref={progressRef}
            className={cn(
              "flex-1 h-1.5 bg-muted rounded-full relative",
              streamComplete && "cursor-pointer group"
            )}
            onClick={
              streamComplete
                ? (e: React.MouseEvent<HTMLDivElement>) => {
                    const audio = audioRef.current
                    const bar = progressRef.current
                    if (!audio || !bar || !duration) return
                    const rect = bar.getBoundingClientRect()
                    const fraction = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width)
                    )
                    audio.currentTime = fraction * duration
                    setCurrentTime(audio.currentTime)
                  }
                : undefined
            }
          >
            {/* Buffer indicator (visible during streaming) */}
            {isStreamMode && hasStreamStarted && !streamComplete && (
              <div
                className="absolute h-full bg-primary/20 rounded-full transition-all"
                style={{ width: `${bufferedProgress}%` }}
              />
            )}
            {/* Playback progress */}
            <div
              className="h-full bg-primary rounded-full transition-all relative"
              style={{ width: `${progress}%` }}
            >
              {streamComplete && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          </div>

          {/* Time display */}
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 min-w-[70px] text-right">
            {formatTime(currentTime)}
            {streamComplete || !isStreamMode
              ? ` / ${formatTime(duration)}`
              : ""}
          </span>

          {/* Speed button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[11px] font-medium shrink-0"
            onClick={cycleSpeed}
          >
            {speed}x
          </Button>
        </div>
      )}
    </div>
  )
}
