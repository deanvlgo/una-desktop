import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type FloatingAgentSubmitPayload = {
  type: 'text' | 'audio';
  text: string;
  transcriptSnapshot?: string;
};

export type FloatingAgentInputProps = {
  defaultExpanded?: boolean;
  lockExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSubmit?: (payload: FloatingAgentSubmitPayload) => void | Promise<void>;
  thinking?: boolean;
  placeholder?: string;
  expandedWidth?: number;
  maxExpandedHeight?: number;
  collapsedWidth?: number;
  height?: number;
  className?: string;
  isRecording?: boolean;
  onStartRecording?: () => void | Promise<void>;
  onStopRecording?: () => void | Promise<void>;
  audioLevel?: number;
  audioBand?: { low: number; mid: number; high: number };
  liveTranscriptText?: string;
  showLiveTranscript?: boolean;
  liveTranscriptLabel?: string;
};

const PINK = '#ff4fd8';
const BLUE = '#2f8bff';
const YELLOW = '#ffd400';

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function TIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 6h14M12 6v12" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 3L10 14" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" />
      <path d="M21 3l-7 18-4-7-7-4 18-7z" stroke="#0b0b0b" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function ExactMicIcon({ size, active }: { size: number; active: boolean }) {
  const VB = 261.075;
  const ink = active ? '#ff5757' : '#0b0b0b';
  const halo = '#ffffff';
  const p1 =
    'M126.855,174.05h5.744c22.447,0,40.641-18.194,40.641-40.641V40.641C173.24,18.194,155.046,0,132.599,0h-5.744c-22.447,0-40.641,18.194-40.641,40.641v92.769C86.215,155.856,104.408,174.05,126.855,174.05z';
  const p2 =
    'M124.288,201.147v43.61H86.215c-4.504,0-8.159,3.65-8.159,8.159s3.655,8.159,8.159,8.159h92.464c4.504,0,8.159-3.65,8.159-8.159s-3.655-8.159-8.159-8.159h-38.073v-43.823c34.832-3.138,63.262-34.44,63.262-71.208c0-4.509-3.655-8.159-8.159-8.159s-8.159,3.65-8.159,8.159c0,29.92-24.122,55.201-52.672,55.201h-8.686c-28.544,0-52.666-24.699-52.666-53.939c0-4.509-3.655-8.159-8.159-8.159s-8.159,3.65-8.159,8.159C57.208,169.073,87.134,200.109,124.288,201.147z';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} aria-hidden="true" style={{ display: 'block' }}>
      <path d={p1} fill="none" stroke={halo} strokeWidth={16} strokeLinejoin="round" />
      <path d={p2} fill="none" stroke={halo} strokeWidth={16} strokeLinejoin="round" />
      <path d={p1} fill="none" stroke={ink} strokeWidth={10} strokeLinejoin="round" />
      <path d={p2} fill="none" stroke={ink} strokeWidth={10} strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 7h3l1-2h2l1 2h3a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z"
        stroke="#0b0b0b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3" stroke="#0b0b0b" strokeWidth="2" />
    </svg>
  );
}

function ExpandIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 10L4 4" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 10l6-6" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 14l-6 6" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 14l6 6" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 4H4v3" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 4h3v3" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v3h3" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 17v3h-3" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 15l6-6 6 6" stroke="#0b0b0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function colorToShadow(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function catmullRomClosed(points: Array<[number, number]>, tension = 0.8) {
  const n = points.length;
  if (n < 2) return '';
  const p = (i: number) => points[(i + n) % n];
  const control = (p0: [number, number], p1: [number, number], p2: [number, number], tt: number) => {
    const d01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const fa = (tt * d01) / (d01 + d12 || 1);
    const fb = tt - fa;
    const c1: [number, number] = [p1[0] + fa * (p0[0] - p2[0]), p1[1] + fa * (p0[1] - p2[1])];
    const c2: [number, number] = [p1[0] - fb * (p0[0] - p2[0]), p1[1] - fb * (p0[1] - p2[1])];
    return { c1, c2 };
  };
  const tt = (1 - tension) * 0.5;
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const cA = control(p0, p1, p2, tt).c2;
    const cB = control(p1, p2, p3, tt).c1;
    d += ` C ${cA[0].toFixed(2)} ${cA[1].toFixed(2)}, ${cB[0].toFixed(2)} ${cB[1].toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

function Blob({
  cx,
  cy,
  r,
  a,
  b,
  c,
  t,
  opacity,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  a: number;
  b: number;
  c: number;
  t: number;
  opacity: number;
  color: string;
}) {
  const pts = 56;
  const angStep = (Math.PI * 2) / pts;
  const k1 = 1.2 + a * 1.0;
  const k2 = 2.1 + b * 1.2;
  const k3 = 3.4 + c * 1.4;
  const rr = (theta: number) => {
    const w1 = 0.1 + a * 0.12;
    const w2 = 0.06 + b * 0.1;
    const w3 = 0.04 + c * 0.08;
    return (
      r *
      (1 +
        w1 * Math.sin(theta * k1 + t * 1.1) +
        w2 * Math.sin(theta * k2 - t * 0.9) +
        w3 * Math.sin(theta * k3 + t * 1.4))
    );
  };
  const points: Array<[number, number]> = [];
  for (let i = 0; i < pts; i++) {
    const theta = i * angStep;
    const rad = rr(theta);
    points.push([cx + rad * Math.cos(theta), cy + rad * Math.sin(theta)]);
  }
  const d = catmullRomClosed(points, 0.9);
  return (
    <path
      d={d}
      fill={color}
      fillOpacity={opacity}
      stroke="none"
      style={{ filter: `drop-shadow(0 0 18px ${colorToShadow(color, 0.18)})` }}
    />
  );
}

function roundedRectPath(w: number, h: number, r: number, inset = 0) {
  const x = inset;
  const y = inset;
  const width = w - inset * 2;
  const height = h - inset * 2;
  const radius = Math.max(0, Math.min(r - inset, width / 2, height / 2));
  if (radius <= 0) return `M ${x},${y + height / 2} L ${x + width},${y + height / 2}`;
  return `M ${x + radius},${y} L ${x + width - radius},${y} Q ${x + width},${y} ${x + width},${y + radius} L ${x + width},${y + height - radius} Q ${x + width},${y + height} ${x + width - radius},${y + height} L ${x + radius},${y + height} Q ${x},${y + height} ${x},${y + height - radius} L ${x},${y + radius} Q ${x},${y} ${x + radius},${y} Z`;
}

function PillBorderOrbit({ w, h, radius }: { w: number; h: number; radius: number }) {
  const pathD = roundedRectPath(w, h, radius, 6);
  const electronR = 6;
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <defs>
          <path id="pillBorderOrbitPath" d={pathD} fill="none" stroke="none" />
          <filter id="electronGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#electronGlow)">
          <circle r={electronR} fill="#2f8bff" style={{ filter: 'drop-shadow(0 0 8px rgba(47,139,255,0.8))' }}>
            <animateMotion dur="1.8s" repeatCount="indefinite" path={pathD} />
          </circle>
          <circle r={electronR * 0.7} fill="#ff4fd8" style={{ filter: 'drop-shadow(0 0 6px rgba(255,79,216,0.8))' }}>
            <animateMotion dur="2.2s" repeatCount="indefinite" path={pathD} begin="-0.9s" />
          </circle>
        </g>
      </svg>
    </div>
  );
}

function PillIconButton({
  children,
  onClick,
  disabled,
  active,
  size,
  ariaLabel,
  accent,
  title,
  grayed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  size: number;
  ariaLabel: string;
  accent?: boolean;
  title?: string;
  grayed?: boolean;
}) {
  const bg = active ? 'rgba(255,255,255,0.86)' : 'rgba(255,255,255,0.62)';
  const border = active ? (accent ? 'rgba(47,139,255,0.42)' : 'rgba(0,0,0,0.14)') : 'rgba(0,0,0,0.10)';
  const isDisabled = disabled && !grayed;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      disabled={isDisabled}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        opacity: disabled || grayed ? 0.65 : 1,
        boxShadow: active ? '0 10px 24px rgba(0,0,0,0.10)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function MiniIconButton({
  children,
  onClick,
  disabled,
  ariaLabel,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 28,
        height: 28,
        borderRadius: 999,
        border: '1px solid rgba(0,0,0,0.10)',
        background: 'rgba(255,255,255,0.62)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function FloatingAgentInput({
  defaultExpanded = false,
  lockExpanded = false,
  onExpandedChange,
  onSubmit,
  thinking = false,
  placeholder = 'What would you like to add or change?',
  expandedWidth = 260,
  maxExpandedHeight = 180,
  collapsedWidth,
  height = 54,
  className = '',
  isRecording = false,
  onStartRecording,
  onStopRecording,
  audioLevel: audioLevelProp,
  audioBand: audioBandProp,
  liveTranscriptText,
  showLiveTranscript = false,
  liveTranscriptLabel = 'Live transcript',
}: FloatingAgentInputProps) {
  const [isExpanded, setIsExpanded] = useState(lockExpanded || defaultExpanded);
  const [composer, setComposer] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [, setComposerH] = useState(0);
  const [level, setLevel] = useState(0);
  const [band, setBand] = useState({ low: 0, mid: 0, high: 0 });
  const [showCameraComingSoon, setShowCameraComingSoon] = useState(false);

  const phaseRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pillContainerRef = useRef<HTMLDivElement | null>(null);
  const cameraComingSoonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioOn = isRecording;

  const openCameraComingSoon = useCallback(() => {
    setShowCameraComingSoon(true);
    if (cameraComingSoonTimeoutRef.current) clearTimeout(cameraComingSoonTimeoutRef.current);
    cameraComingSoonTimeoutRef.current = setTimeout(() => {
      setShowCameraComingSoon(false);
      cameraComingSoonTimeoutRef.current = null;
    }, 2500);
  }, []);

  useEffect(() => {
    if (!showCameraComingSoon) return;
    const close = () => setShowCameraComingSoon(false);
    const onDocClick = (e: MouseEvent) => {
      const el = pillContainerRef.current;
      if (el && !el.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showCameraComingSoon]);

  useEffect(
    () => () => {
      if (cameraComingSoonTimeoutRef.current) clearTimeout(cameraComingSoonTimeoutRef.current);
    },
    [],
  );

  const dims = useMemo(() => {
    const h = height;
    const pad = Math.round(h * 0.14);
    const icon = Math.round(h * 0.72);
    return { h, pad, icon };
  }, [height]);

  const minComposerH = Math.max(60, Math.round(dims.h * 0.58));
  const maxComposerH = Math.round(dims.h * 0.58 + dims.h * 2.8);
  const collapsedGap = 8;
  const collapsedPad = 8;
  const collapsedHandle = 28;
  const collapsedH = collapsedPad * 2 + 3 * dims.icon + 3 * collapsedGap + collapsedHandle;
  const minExpandedH = 100;
  const expanded = lockExpanded || isExpanded;
  const currentH = expanded
    ? Math.min(maxExpandedHeight, Math.max(minExpandedH, maxExpandedHeight))
    : collapsedH;
  const wCollapsed = Math.max(collapsedWidth ?? 66, dims.icon + collapsedPad * 2);
  const w = expanded ? expandedWidth : wCollapsed;
  const radius = expanded ? 22 : 18;
  const glow = 0.18 + level * 0.75;
  const blobA = 0.18 + band.low * 0.85;
  const blobB = 0.18 + band.mid * 0.85;
  const blobC = 0.18 + band.high * 0.85;
  const disabled = thinking;

  const hasRealAudio = audioLevelProp !== undefined && audioBandProp !== undefined;
  const isRecordingActive = isRecording;
  const currentLiveTranscript = (liveTranscriptText ?? '').trim();
  const showLiveTranscriptPanel =
    expanded && showLiveTranscript && (isRecordingActive || currentLiveTranscript.length > 0);

  useEffect(() => {
    if (lockExpanded) {
      setIsExpanded(true);
    }
  }, [lockExpanded]);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  useEffect(() => {
    if (!isRecordingActive) {
      setLevel(0);
      setBand({ low: 0, mid: 0, high: 0 });
      return;
    }

    if (hasRealAudio) {
      const level = Math.max(0, Math.min(1, audioLevelProp ?? 0));
      const band = audioBandProp ?? { low: 0, mid: 0, high: 0 };
      setLevel((prev) => prev * 0.5 + level * 0.5);
      setBand((prev) => ({
        low: prev.low * 0.5 + (band.low ?? 0) * 0.5,
        mid: prev.mid * 0.5 + (band.mid ?? 0) * 0.5,
        high: prev.high * 0.5 + (band.high ?? 0) * 0.5,
      }));
    }
  }, [
    isRecordingActive,
    hasRealAudio,
    audioLevelProp,
    audioBandProp?.low,
    audioBandProp?.mid,
    audioBandProp?.high,
  ]);

  useEffect(() => {
    if (!isRecordingActive || !hasRealAudio) return;
    const loop = () => {
      phaseRef.current = performance.now() / 1000;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isRecordingActive, hasRealAudio]);

  useEffect(() => {
    if (!isRecordingActive || hasRealAudio) return;
    if (rafRef.current) return;
    const startedAt = performance.now();
    const noise = (x: number) => {
      const v = Math.sin(x * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    const loop = () => {
      const t = (performance.now() - startedAt) / 1000;
      phaseRef.current = t;
      const swell = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.7));
      const pulses = Math.max(0, Math.sin(t * 2.2)) * (0.55 + 0.45 * Math.sin(t * 1.3 + 0.9));
      const jitter = (noise(t * 3.7) - 0.5) * 0.12;
      const targetLevel = clamp01(swell * 0.35 + pulses * 0.7 + jitter);
      const low = clamp01(
        0.18 + 0.78 * (0.5 + 0.5 * Math.sin(t * 1.7 + 0.2)) + (noise(t * 4.1) - 0.5) * 0.14,
      );
      const mid = clamp01(
        0.18 + 0.78 * (0.5 + 0.5 * Math.sin(t * 2.4 + 1.1)) + (noise(t * 4.9) - 0.5) * 0.14,
      );
      const high = clamp01(
        0.18 + 0.78 * (0.5 + 0.5 * Math.sin(t * 3.2 + 2.2)) + (noise(t * 5.7) - 0.5) * 0.14,
      );
      setLevel((prev) => prev + (targetLevel - prev) * 0.14);
      setBand((prev) => ({
        low: prev.low + (low - prev.low) * 0.16,
        mid: prev.mid + (mid - prev.mid) * 0.16,
        high: prev.high + (high - prev.high) * 0.16,
      }));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setLevel(0);
      setBand({ low: 0, mid: 0, high: 0 });
    };
  }, [isRecordingActive, hasRealAudio]);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const expand = useCallback(() => {
    if (lockExpanded) return;
    setIsExpanded(true);
  }, [lockExpanded]);

  const minimize = useCallback(() => {
    if (lockExpanded) return;
    setIsExpanded(false);
    setIsFocused(false);
    textareaRef.current?.blur();
  }, [lockExpanded]);

  const submitText = useCallback(async () => {
    const typed = composer.trim();
    const transcript = currentLiveTranscript;
    const text = typed || transcript;
    if (!text) return;

    await onSubmit?.({
      type: typed ? 'text' : 'audio',
      text,
      transcriptSnapshot: transcript || undefined,
    });

    if (typed) {
      setComposer('');
    }
  }, [composer, currentLiveTranscript, onSubmit]);

  const onComposerChange = useCallback((v: string) => {
    setComposer(v);
  }, []);

  const onComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submitText();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        minimize();
      }
    },
    [submitText, minimize],
  );

  const onPressT = useCallback(() => {
    if (disabled) return;
    expand();
    focusComposer();
  }, [disabled, expand, focusComposer]);

  const onPressMic = useCallback(async () => {
    if (disabled || !onStartRecording || !onStopRecording) return;
    if (isRecording) {
      await onStopRecording();
    } else {
      await onStartRecording();
    }
  }, [disabled, isRecording, onStartRecording, onStopRecording]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(maxComposerH, Math.max(minComposerH, el.scrollHeight));
    setComposerH(next);
    el.style.height = `${next}px`;
  }, [composer, maxComposerH, minComposerH]);

  const audioOnVisual = audioOn;

  return (
    <div
      ref={pillContainerRef}
      className={className}
      style={{
        position: 'relative',
        width: w,
        height: currentH,
        transition: 'height 220ms cubic-bezier(.2,.8,.2,1)',
      }}
    >
      {showCameraComingSoon ? (
        <div
          role="tooltip"
          aria-live="polite"
          style={{
            position: 'absolute',
            right: '100%',
            top: '50%',
            transform: 'translateY(-50%) translateX(-8px)',
            padding: '8px 14px',
            borderRadius: 12,
            background: 'rgba(0,0,0,0.82)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            zIndex: 100,
          }}
        >
          Coming soon
        </div>
      ) : null}

      {thinking ? <PillBorderOrbit w={w} h={currentH} radius={radius} /> : null}

      <div
        role="group"
        aria-label="Agent input"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: radius,
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          padding: expanded ? 10 : collapsedPad,
          overflow: 'visible',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: radius,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.10)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.10)',
          }}
        >
          <svg
            width={w}
            height={currentH}
            viewBox={`0 0 ${w} ${currentH}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <filter id="airyGlowPill" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation={Math.max(2, currentH * 0.1)} result="b" />
                <feColorMatrix
                  in="b"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.75 0"
                  result="c"
                />
                <feMerge>
                  <feMergeNode in="c" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="pillAura" cx="50%" cy="50%" r="70%">
                <stop offset="0%" stopColor={PINK} stopOpacity={audioOnVisual ? 0.1 + glow * 0.12 : 0.04} />
                <stop offset="50%" stopColor={BLUE} stopOpacity={audioOnVisual ? 0.07 + glow * 0.1 : 0.03} />
                <stop offset="100%" stopColor={YELLOW} stopOpacity={0} />
              </radialGradient>
            </defs>
            <rect x={0} y={0} width={w} height={currentH} rx={radius} fill="url(#pillAura)" />
            {audioOnVisual && !thinking ? (
              <g filter="url(#airyGlowPill)">
                <Blob
                  cx={w * 0.52}
                  cy={currentH * 0.54}
                  r={Math.min(currentH, w) * 0.58}
                  a={blobA}
                  b={blobB}
                  c={blobC}
                  t={phaseRef.current}
                  opacity={0.1 + glow * 0.16}
                  color={PINK}
                />
                <Blob
                  cx={w * 0.52}
                  cy={currentH * 0.48}
                  r={Math.min(currentH, w) * 0.48}
                  a={blobB}
                  b={blobC}
                  c={blobA}
                  t={phaseRef.current + 0.7}
                  opacity={0.08 + glow * 0.12}
                  color={BLUE}
                />
                <Blob
                  cx={w * 0.52}
                  cy={currentH * 0.5}
                  r={Math.min(currentH, w) * 0.64}
                  a={blobC}
                  b={blobA}
                  c={blobB}
                  t={phaseRef.current + 1.25}
                  opacity={0.05 + glow * 0.1}
                  color={YELLOW}
                />
              </g>
            ) : null}
          </svg>
        </div>

        {!expanded ? (
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: collapsedGap,
              width: '100%',
              height: '100%',
            }}
          >
            <PillIconButton ariaLabel="Text" onClick={onPressT} disabled={disabled} active={false} size={dims.icon}>
              <TIcon size={dims.icon * 0.55} />
            </PillIconButton>
            <PillIconButton
              ariaLabel={audioOnVisual ? 'Stop audio' : 'Audio'}
              onClick={() => {
                void onPressMic();
              }}
              disabled={disabled}
              active={audioOnVisual}
              size={dims.icon}
              accent
            >
              <ExactMicIcon size={dims.icon * 0.7} active={audioOnVisual} />
            </PillIconButton>
            <PillIconButton
              ariaLabel="Camera (coming soon)"
              onClick={openCameraComingSoon}
              grayed
              title="Coming soon"
              active={false}
              size={dims.icon}
            >
              <CameraIcon size={Math.round(dims.icon * 0.54)} />
            </PillIconButton>
            {!lockExpanded ? (
              <MiniIconButton ariaLabel="Expand" onClick={expand} disabled={disabled} title="Expand">
                <ExpandIcon size={16} />
              </MiniIconButton>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'row',
              gap: 12,
              flex: 1,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }}
            >
              {showLiveTranscriptPanel ? (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    marginBottom: 8,
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.08)',
                    background: 'rgba(255,255,255,0.78)',
                    padding: '8px 10px',
                    minHeight: 46,
                    maxHeight: 96,
                    overflowY: 'auto',
                    fontSize: 12,
                    lineHeight: '17px',
                    color: '#1f2937',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      color: '#6b7280',
                      marginBottom: 2,
                    }}
                  >
                    {liveTranscriptLabel}
                  </div>
                  <div style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {currentLiveTranscript || 'Listening…'}
                  </div>
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                value={composer}
                onChange={(e) => onComposerChange(e.target.value)}
                onKeyDown={onComposerKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={thinking ? 'Thinking…' : audioOnVisual ? 'Type while listening…' : placeholder}
                aria-label="Composer"
                disabled={disabled}
                rows={1}
                style={{
                  width: '100%',
                  flex: 1,
                  minHeight: 0,
                  resize: 'none',
                  overflow: 'auto',
                  borderRadius: 16,
                  border: '1px solid rgba(0,0,0,0.10)',
                  background: 'rgba(255,255,255,0.86)',
                  padding: '12px 48px 44px 14px',
                  outline: 'none',
                  fontSize: 14,
                  lineHeight: '20px',
                  color: '#0b0b0b',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  void submitText();
                }}
                disabled={disabled || (composer.trim().length === 0 && currentLiveTranscript.length === 0)}
                aria-label="Send"
                style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 10,
                  height: 36,
                  width: 36,
                  borderRadius: 999,
                  border: '1px solid rgba(0,0,0,0.10)',
                  background: disabled ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.92)',
                  cursor:
                    disabled || (composer.trim().length === 0 && currentLiveTranscript.length === 0)
                      ? 'not-allowed'
                      : 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow:
                    composer.trim().length || currentLiveTranscript.length
                      ? '0 4px 12px rgba(0,0,0,0.12)'
                      : 'none',
                }}
              >
                <SendIcon size={16} />
              </button>
            </div>

            <div
              style={{
                width: dims.icon + 10,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                paddingTop: 2,
              }}
            >
              <PillIconButton ariaLabel="Text" onClick={onPressT} disabled={disabled} active={isFocused} size={dims.icon}>
                <TIcon size={dims.icon * 0.55} />
              </PillIconButton>
              <PillIconButton
                ariaLabel={audioOnVisual ? 'Stop audio' : 'Audio'}
                onClick={() => {
                  void onPressMic();
                }}
                disabled={disabled}
                active={audioOnVisual}
                size={dims.icon}
                accent
              >
                <ExactMicIcon size={dims.icon * 0.7} active={audioOnVisual} />
              </PillIconButton>
              <PillIconButton
                ariaLabel="Camera (coming soon)"
                onClick={openCameraComingSoon}
                grayed
                title="Coming soon"
                active={false}
                size={dims.icon}
              >
                <CameraIcon size={Math.round(dims.icon * 0.54)} />
              </PillIconButton>
              {!lockExpanded ? (
                <MiniIconButton ariaLabel="Minimize" onClick={minimize} disabled={disabled} title="Minimize">
                  <ChevronUpIcon size={14} />
                </MiniIconButton>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
