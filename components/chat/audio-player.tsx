"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Play, Pause, Volume2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface TTSStreamConfig {
  text: string
  voice?: string
  model?: string
  speed?: number
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
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(1) // Default 1x
  const [isBuffering, setIsBuffering] = useState(!!streamConfig)
  const [streamComplete, setStreamComplete] = useState(!streamConfig)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [bufferedTime, setBufferedTime] = useState(0)
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

  // Streaming setup — runs once on mount
  useEffect(() => {
    if (!streamConfig || audioUrl || streamInitiatedRef.current) return
    streamInitiatedRef.current = true

    const abortController = new AbortController()
    abortRef.current = abortController

    // Check MediaSource support for audio/mpeg
    const canUseMediaSource =
      typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported("audio/mpeg")

    if (canUseMediaSource) {
      startMediaSourceStream(streamConfig, abortController.signal)
    } else {
      startFallbackStream(streamConfig, abortController.signal)
    }

    return () => {
      abortController.abort()
      if (mediaSourceUrlRef.current) {
        URL.revokeObjectURL(mediaSourceUrlRef.current)
        mediaSourceUrlRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startMediaSourceStream(
    config: TTSStreamConfig,
    signal: AbortSignal
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

      const res = await fetch("/api/doc/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: config.text,
          voice: config.voice || "nova",
          model: config.model || "tts-1",
          speed: config.speed || 1.0,
        }),
        signal,
      })

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(
          (errData as { error?: string }).error || "TTS streaming failed"
        )
      }

      const reader = res.body.getReader()
      let firstChunkReceived = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted) return

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
          // Auto-play after first chunk arrives
          const a = audioRef.current
          if (a) {
            a.play()
              .then(() => setIsPlaying(true))
              .catch(() => setIsPlaying(false))
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
    } catch (err) {
      if (signal.aborted) return
      console.error("[AudioPlayer] MediaSource stream error:", err)
      setStreamError(err instanceof Error ? err.message : "Streaming failed")
      setIsBuffering(false)
    }
  }

  async function startFallbackStream(
    config: TTSStreamConfig,
    signal: AbortSignal
  ) {
    try {
      const res = await fetch("/api/doc/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: config.text,
          voice: config.voice || "nova",
          model: config.model || "tts-1",
          speed: config.speed || 1.0,
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
      if (signal.aborted) return

      const blobUrl = URL.createObjectURL(blob)
      const audio = audioRef.current
      if (audio) {
        audio.src = blobUrl
        audio.play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false))
      }
      setIsBuffering(false)
      setStreamComplete(true)
    } catch (err) {
      if (signal.aborted) return
      console.error("[AudioPlayer] Fallback stream error:", err)
      setStreamError(err instanceof Error ? err.message : "TTS failed")
      setIsBuffering(false)
    }
  }

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

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
        "flex flex-col gap-2 p-3 rounded-xl bg-primary/5 border border-primary/10",
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
          {isStreamMode && !streamComplete && (
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
            {isStreamMode && !streamComplete && (
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
