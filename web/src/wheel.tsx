// A scroll wheel picker like the iPhone's alarm clock: flick or drag a column
// of values and whichever one stops in the middle band is chosen. Works with
// touch, a mouse wheel, taps on a value, and the arrow keys.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react';

const ROW = 40; // px; must match .wheel-row in styles.css
const SIDE_ROWS = 2; // rows visible above and below the chosen one

type WheelProps<T> = {
  label: string;
  options: T[];
  value: number; // index into options
  onChange: (index: number) => void;
  render: (option: T) => string;
};

export function Wheel<T>({ label, options, value, onChange, render }: WheelProps<T>) {
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  // The index the wheel is showing, so a value we reported doesn't bounce back
  // in as an outside change.
  const shown = useRef(value);

  const clamp = useCallback((i: number) => Math.min(options.length - 1, Math.max(0, i)), [options.length]);

  // Tilt and fade the rows away from the middle, like a drum.
  const paint = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const center = el.scrollTop / ROW;
    el.querySelectorAll<HTMLElement>('.wheel-row').forEach((row, i) => {
      const offset = Math.max(-3, Math.min(3, i - center));
      const d = Math.abs(offset);
      row.style.transform = `rotateX(${offset * -20}deg) scale(${1 - d * 0.07})`;
      row.style.opacity = String(Math.max(0.15, 1 - d * 0.3));
    });
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = value * ROW;
    shown.current = value;
    paint();
    // Only on mount: later outside changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value !== shown.current) {
      shown.current = value;
      scroller.current?.scrollTo({ top: value * ROW, behavior: 'smooth' });
    }
  }, [value]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      paint();
      const i = clamp(Math.round(el.scrollTop / ROW));
      if (i !== shown.current) {
        shown.current = i;
        onChange(i);
      }
    });
  }

  function goTo(i: number) {
    scroller.current?.scrollTo({ top: clamp(i) * ROW, behavior: 'smooth' });
  }

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
    if (e.key in moves) goTo(shown.current + moves[e.key]);
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(options.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div className="wheel">
      <div className="wheel-label" id={`${id}-label`}>
        {label}
      </div>
      <div className="wheel-window" style={{ height: ROW * (SIDE_ROWS * 2 + 1) }}>
        <div className="wheel-band" style={{ top: ROW * SIDE_ROWS, height: ROW }} aria-hidden="true" />
        <div
          ref={scroller}
          className="wheel-scroll"
          style={{ paddingBlock: ROW * SIDE_ROWS }}
          role="listbox"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-${value}`}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
        >
          {options.map((option, i) => (
            <div
              key={i}
              id={`${id}-${i}`}
              className="wheel-row"
              role="option"
              aria-selected={i === value}
              onClick={() => goTo(i)}
            >
              {render(option)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
