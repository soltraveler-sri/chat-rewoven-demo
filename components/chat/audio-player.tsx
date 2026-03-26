"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Play, Pause, RotateCcw, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface AudioPlayerProps {
  /** URL to the audio blob */
  audioUrl: string
  /** Document filename for display */
  filename?: string
  /** TTS voice used */
  voice?: string
  className?: string
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const

export function AudioPlayer({
  audioUrl,
  filename,
  voice,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(1) // Default 1x
  const progressRef = useRef<HTMLDivElement>(null)

  const speed = SPEED_OPTIONS[speedIndex]

  // Update time display
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)
    const onEnded = () => setIsPlaying(false)

    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("ended", onEnded)

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("ended", onEnded)
    }
  }, [audioUrl])

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

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    const bar = progressRef.current
    if (!audio || !bar || !duration) return

    const rect = bar.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = fraction * duration
    setCurrentTime(audio.currentTime)
  }, [duration])

  const cycleSpeed = useCallback(() => {
    const nextIndex = (speedIndex + 1) % SPEED_OPTIONS.length
    setSpeedIndex(nextIndex)
    const audio = audioRef.current
    if (audio) {
      audio.playbackRate = SPEED_OPTIONS[nextIndex]
    }
  }, [speedIndex])

  const restart = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setCurrentTime(0)
    if (!isPlaying) {
      audio.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 rounded-xl bg-primary/5 border border-primary/10",
        className
      )}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

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
        </div>
      )}

      {/* Controls row */}
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

        {/* Progress bar */}
        <div
          ref={progressRef}
          className="flex-1 h-1.5 bg-muted rounded-full cursor-pointer relative group"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-primary rounded-full transition-all relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Time display */}
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 min-w-[70px] text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
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

        {/* Restart button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={restart}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
