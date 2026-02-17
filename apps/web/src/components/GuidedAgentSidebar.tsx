import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import FloatingAgentInput, { type FloatingAgentSubmitPayload } from './FloatingAgentInput';

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

type GuidedAgentSidebarProps = {
  onPromptSubmit?: (payload: FloatingAgentSubmitPayload) => void | Promise<void>;
  thinking?: boolean;
};

type CueKind = 'start' | 'stop' | 'error';

let cueContext: AudioContext | null = null;

function getCueContext(): AudioContext | null {
  const webkitAudioContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const AudioContextCtor = window.AudioContext ?? webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }
  if (!cueContext || cueContext.state === 'closed') {
    cueContext = new AudioContextCtor();
  }
  return cueContext;
}

function scheduleTone(
  context: AudioContext,
  startAt: number,
  frequency: number,
  durationSec: number,
  gain = 0.06,
) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSec);
}

async function playDictationCue(kind: CueKind) {
  try {
    const context = getCueContext();
    if (!context) {
      return;
    }
    if (context.state === 'suspended') {
      await context.resume();
    }

    const t0 = context.currentTime + 0.01;
    if (kind === 'start') {
      scheduleTone(context, t0, 700, 0.07, 0.05);
      scheduleTone(context, t0 + 0.09, 950, 0.09, 0.05);
      return;
    }
    if (kind === 'stop') {
      scheduleTone(context, t0, 720, 0.09, 0.045);
      scheduleTone(context, t0 + 0.11, 560, 0.11, 0.045);
      return;
    }
    scheduleTone(context, t0, 440, 0.12, 0.07);
    scheduleTone(context, t0 + 0.16, 330, 0.12, 0.07);
    scheduleTone(context, t0 + 0.32, 260, 0.18, 0.08);
  } catch {
    // Ignore cue errors (autoplay policy/device limitations).
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function GuidedAgentSidebar({ onPromptSubmit, thinking = false }: GuidedAgentSidebarProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState<number | undefined>(undefined);
  const [audioBand, setAudioBand] = useState<{ low: number; mid: number; high: number } | undefined>(undefined);
  const liveTranscriptRef = useRef('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const stopRequestedRef = useRef(false);
  const finalTranscriptRef = useRef('');
  const meterContextRef = useRef<AudioContext | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterAnalyserRef = useRef<AnalyserNode | null>(null);
  const meterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meterRafRef = useRef<number | null>(null);

  const stopAudioMeter = useCallback(() => {
    const rafId = meterRafRef.current;
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      meterRafRef.current = null;
    }

    const source = meterSourceRef.current;
    if (source) {
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    }
    meterSourceRef.current = null;
    meterAnalyserRef.current = null;

    const stream = meterStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    meterStreamRef.current = null;

    const context = meterContextRef.current;
    meterContextRef.current = null;
    if (context) {
      void context.close().catch(() => {
        // ignore
      });
    }

    setAudioLevel(undefined);
    setAudioBand(undefined);
  }, []);

  const startAudioMeter = useCallback(async () => {
    stopAudioMeter();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      return;
    }

    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      meterContextRef.current = context;
      meterStreamRef.current = stream;
      meterSourceRef.current = source;
      meterAnalyserRef.current = analyser;

      const timeDomainData = new Uint8Array(analyser.fftSize);
      const frequencyData = new Uint8Array(analyser.frequencyBinCount);
      const computeBandAverage = (start: number, end: number) => {
        const safeEnd = Math.min(end, frequencyData.length);
        if (safeEnd <= start) {
          return 0;
        }
        let total = 0;
        for (let index = start; index < safeEnd; index += 1) {
          total += frequencyData[index] / 255;
        }
        return total / (safeEnd - start);
      };

      const animate = () => {
        const activeAnalyser = meterAnalyserRef.current;
        if (!activeAnalyser) {
          meterRafRef.current = null;
          return;
        }

        activeAnalyser.getByteTimeDomainData(timeDomainData);
        let sumSquares = 0;
        for (let index = 0; index < timeDomainData.length; index += 1) {
          const centered = (timeDomainData[index] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / timeDomainData.length);
        const normalizedLevel = Math.max(0, Math.min(1, rms * 3.2));

        activeAnalyser.getByteFrequencyData(frequencyData);
        const bandWidth = Math.floor(frequencyData.length / 3);
        const low = computeBandAverage(0, bandWidth);
        const mid = computeBandAverage(bandWidth, bandWidth * 2);
        const high = computeBandAverage(bandWidth * 2, frequencyData.length);

        setAudioLevel((previous) => {
          const baseline = previous ?? normalizedLevel;
          return baseline * 0.65 + normalizedLevel * 0.35;
        });
        setAudioBand((previous) => {
          const prior = previous ?? { low, mid, high };
          return {
            low: prior.low * 0.65 + low * 0.35,
            mid: prior.mid * 0.65 + mid * 0.35,
            high: prior.high * 0.65 + high * 0.35,
          };
        });

        meterRafRef.current = requestAnimationFrame(animate);
      };

      meterRafRef.current = requestAnimationFrame(animate);
    } catch (error) {
      console.warn('Audio meter unavailable', error);
      stopAudioMeter();
    }
  }, [stopAudioMeter]);

  const stopRecording = useCallback(async (): Promise<string> => {
    stopRequestedRef.current = true;
    stopAudioMeter();

    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    }

    setIsRecording(false);
    const finalText = liveTranscriptRef.current.trim() || finalTranscriptRef.current.trim();
    finalTranscriptRef.current = finalText;
    liveTranscriptRef.current = finalText;
    setLiveTranscript(finalText);
    return finalText;
  }, [stopAudioMeter]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (isRecording) {
      return false;
    }

    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      console.warn('Speech recognition is not supported in this browser.');
      return false;
    }

    stopRequestedRef.current = false;
    finalTranscriptRef.current = '';
    liveTranscriptRef.current = '';
    setLiveTranscript('');

    try {
      await startAudioMeter();

      const recognition = new RecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let nextFinal = finalTranscriptRef.current;
        let interim = '';

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = String(result?.[0]?.transcript ?? '').trim();
          if (!text) {
            continue;
          }

          if (result.isFinal) {
            nextFinal = nextFinal.length > 0 ? `${nextFinal} ${text}` : text;
          } else {
            interim = interim.length > 0 ? `${interim} ${text}` : text;
          }
        }

        finalTranscriptRef.current = nextFinal.trim();
        const combined = [finalTranscriptRef.current, interim.trim()].filter(Boolean).join(' ').trim();
        liveTranscriptRef.current = combined;
        setLiveTranscript(combined);
      };

      recognition.onerror = (event: any) => {
        const error = String(event?.error ?? 'unknown');
        if (error === 'aborted' || (error === 'no-speech' && stopRequestedRef.current)) {
          return;
        }
        if (error === 'not-allowed') {
          console.warn('Microphone permission denied.');
        } else {
          console.warn(`Speech recognition error: ${error}`);
        }
      };

      recognition.onend = () => {
        if (stopRequestedRef.current) {
          setIsRecording(false);
          return;
        }

        try {
          recognition.start();
          setIsRecording(true);
        } catch (error) {
          console.warn('Speech recognition restart failed', error);
          setIsRecording(false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
      return true;
    } catch (error) {
      console.warn('Failed to start speech recognition', error);
      stopAudioMeter();
      setIsRecording(false);
      return false;
    }
  }, [isRecording, startAudioMeter, stopAudioMeter]);

  const handleStartRecording = useCallback(async () => {
    const started = await startRecording();
    if (started) {
      await playDictationCue('start');
    }
  }, [startRecording]);

  const handleStopRecording = useCallback(async () => {
    const finalText = (await stopRecording()).trim();
    await playDictationCue('stop');

    if (!finalText) {
      return;
    }

    await onPromptSubmit?.({
      type: 'audio',
      text: finalText,
      transcriptSnapshot: finalText,
    });
  }, [onPromptSubmit, stopRecording]);

  useEffect(() => {
    return () => {
      void stopRecording();
      stopAudioMeter();
    };
  }, [stopAudioMeter, stopRecording]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <section className="desktop-agent-panel" aria-label="AI assistant">
      <div className="desktop-agent-panel__widget-host">
        <FloatingAgentInput
          defaultExpanded={false}
          showLiveTranscript
          liveTranscriptText={liveTranscript}
          isRecording={isRecording}
          audioLevel={audioLevel}
          audioBand={audioBand}
          thinking={thinking}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onSubmit={async (payload) => {
            const text = payload.text.trim();
            if (!text) {
              return;
            }
            await onPromptSubmit?.({ ...payload, text });
          }}
          expandedWidth={260}
          maxExpandedHeight={180}
        />
      </div>
    </section>,
    document.body,
  );
}
