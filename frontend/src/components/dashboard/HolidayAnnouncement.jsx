// src/components/dashboard/HolidayAnnouncement.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PartyPopper } from "lucide-react";
import { holidayService } from "../../services/holidayService";

const SPEED_PX_PER_SEC = 80;

// GET /holidays may wrap the list as { data: [...] } or { holidays: [...] }.
const unwrap = (res) => {
  const body = res?.data;
  const inner = body?.data ?? body?.holidays ?? body?.records ?? body;
  return Array.isArray(inner) ? inner : [];
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysUntil = (dateStr) =>
  Math.round(
    (startOfDay(dateStr) - startOfDay(new Date())) / (1000 * 60 * 60 * 24),
  );

const buildMessage = (holiday) => {
  const dateLabel = new Date(holiday.startDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const d = daysUntil(holiday.startDate);
  const when =
    d <= 0
      ? "is today"
      : d === 1
        ? "is coming tomorrow"
        : `is coming in ${d} days`;
  return `${dateLabel}${holiday.name ? ` — ${holiday.name}` : ""} ${when}!`;
};

const HolidayAnnouncement = () => {
  const [next, setNext] = useState(null);
  const containerRef = useRef(null);
  const messageRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    holidayService
      .getAll()
      .then((res) => {
        if (!mounted) return;
        const today = startOfDay(new Date());
        const upcoming = unwrap(res)
          .filter((h) => h.startDate && startOfDay(h.startDate) >= today)
          .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        setNext(upcoming[0] || null);
      })
      .catch(() => mounted && setNext(null));
    return () => {
      mounted = false;
    };
  }, []);

  // Measure once (and on resize) to keep a constant scroll speed; the
  // animation itself runs entirely in CSS on the compositor.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const message = messageRef.current;
    if (!next || !container || !message) return;

    const update = () => {
      const distance = container.offsetWidth + message.offsetWidth;
      container.style.setProperty(
        "--ticker-duration",
        `${Math.max(distance / SPEED_PX_PER_SEC, 4)}s`,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [next]);

  if (!next) return null;

  return (
    <div className="hidden md:flex flex-1 min-w-0 px-2 justify-end">
      <div ref={containerRef} className="relative overflow-hidden h-6 w-full">
        <div className="ticker-track absolute inset-0">
          <div
            ref={messageRef}
            className="ticker-msg absolute top-0 left-0 h-full inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium text-amber-700"
          >
            <PartyPopper size={14} className="text-amber-500 shrink-0" />
            <span>{buildMessage(next)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HolidayAnnouncement;
