import { WidgetIconGlyph } from '../../../src/app/react/components/WidgetIconGlyph.tsx';
import { clockFace, CLOCK_VIEW_SIZE } from '../../../src/app/utils/clockWidget.ts';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { nextTimerStep, timerSecondsAt, type SharedWidget, type SharedWidgetBar } from '../../../src/app/online/protocol/widgets.ts';
import { playerText } from '../i18n.ts';

export interface WidgetBarProps { readonly bar: SharedWidgetBar | null }

function timerText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function shownValue(widget: SharedWidget, elapsed: number): string {
  if (widget.kind === 'timer') {
    const left = widget.since === undefined ? widget.value * 1000 : widget.value * 1000 - widget.since - elapsed;
    return timerText(timerSecondsAt(widget.value, left));
  }
  if (widget.kind === 'clock') return widget.showCount ? `${widget.value}/${widget.segments ?? 0}` : `${widget.value} / ${widget.segments ?? 0}`;
  return String(widget.value);
}

export function WidgetBar({ bar }: WidgetBarProps): ReactElement | null {
  const receiveTime = useMemo(() => performance.now(), [bar]);
  const [now, setNow] = useState(receiveTime);
  useEffect(() => setNow(receiveTime), [receiveTime]);
  useEffect(() => {
    if (bar === null) return undefined;
    const timers = bar.widgets.filter((widget) => widget.kind === 'timer' && widget.since !== undefined);
    if (timers.length === 0) return undefined;
    const elapsed = Math.max(0, performance.now() - receiveTime);
    const delay = timers.reduce<number>((next, widget) => {
      const left = widget.value * 1000 - (widget.since ?? 0) - elapsed;
      const step = nextTimerStep(widget.value, left);
      return step === null ? next : Math.min(next, step);
    }, Infinity);
    if (!Number.isFinite(delay)) return undefined;
    const timeout = window.setTimeout(() => setNow(performance.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [bar, receiveTime, now]);
  if (bar === null || bar.widgets.length === 0) return null;
  const elapsed = Math.max(0, now - receiveTime);
  return <section className="atlas-player__widgets" aria-label={playerText('widgets')} style={{ transform: `scale(${bar.scale})`, transformOrigin: 'left center' }}>
    {bar.widgets.map((widget, index) => <div className="atlas-player__widget" key={`${index}:${widget.kind}:${widget.label}`} style={widget.colour === null ? undefined : { color: widget.colour }}>
      <WidgetIconGlyph icon={widget.icon} /><span>{widget.label}</span>{widget.kind === 'clock' ? <Clock widget={widget} /> : <strong>{shownValue(widget, elapsed)}</strong>}
    </div>)}
  </section>;
}

function Clock({ widget }: { readonly widget: SharedWidget }): ReactElement {
  const face = clockFace(widget.segments ?? 2, widget.value, widget.showCount ?? false);
  return <svg width="40" height="40" viewBox={`0 0 ${CLOCK_VIEW_SIZE} ${CLOCK_VIEW_SIZE}`} role="img" aria-label={`${widget.label}: ${widget.value}/${widget.segments}`}>
    {face.wedges.map((path, index) => <path key={index} d={path} fill={index < widget.value ? 'currentColor' : 'var(--background-primary)'} stroke="currentColor" strokeWidth="0.7" />)}
    {face.count && <text x="16" y="16" dominantBaseline="central" textAnchor="middle" fill="currentColor" fontSize={face.count.fontSize}>{face.count.text}</text>}
  </svg>;
}
