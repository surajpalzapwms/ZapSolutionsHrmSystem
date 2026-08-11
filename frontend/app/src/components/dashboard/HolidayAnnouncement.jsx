
// src/components/dashboard/HolidayAnnouncement.jsx

import React, { useEffect, useRef, useState } from "react";
import { PartyPopper } from "lucide-react";
import { holidayService } from "../../services/holidayService";

// GET /holidays kabhi { data: [...] }, kabhi { holidays: [...] } wrap karta
// hai — dono handle kar lete hain.
const unwrap = (res) => {
  const body = res?.data;
  const inner =
    body?.data ??
    body?.holidays ??
    body?.records ??
    body;

  return Array.isArray(inner) ? inner : [];
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysUntil = (dateStr) => {
  const today = startOfDay(new Date());
  const target = startOfDay(dateStr);

  return Math.round(
    (target - today) /
      (1000 * 60 * 60 * 24)
  );
};

const HolidayAnnouncement = () => {
  const [next, setNext] = useState(null);

  // Current X position of message
  const positionRef = useRef(0);

  // Direction:
  // 1  = left -> right
  // -1 = right -> left
  const directionRef = useRef(1);

  const animationRef = useRef(null);

  const containerRef = useRef(null);
  const messageRef = useRef(null);

  // --------------------------------------------------
  // Get upcoming holiday
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true;

    holidayService
      .getAll()
      .then((res) => {
        if (!mounted) return;

        const today = startOfDay(new Date());

        const upcoming = unwrap(res)
          .filter(
            (h) =>
              h.startDate &&
              startOfDay(h.startDate) >= today
          )
          .sort(
            (a, b) =>
              new Date(a.startDate) -
              new Date(b.startDate)
          );

        setNext(upcoming[0] || null);
      })
      .catch(() => {
        if (mounted) {
          setNext(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // --------------------------------------------------
  // JavaScript animation
  // --------------------------------------------------

  useEffect(() => {
    if (!next) return;

    const container = containerRef.current;
    const message = messageRef.current;

    if (!container || !message) return;

    let lastTime = performance.now();

    const speed = 80; // pixels per second

    const animate = (currentTime) => {
      const deltaTime =
        (currentTime - lastTime) / 1000;

      lastTime = currentTime;

      const containerWidth =
        container.offsetWidth;

      const messageWidth =
        message.offsetWidth;

      // Message starts completely outside
      // the LEFT side.
      const leftLimit = -messageWidth;

      // Message ends completely outside
      // the RIGHT side.
      const rightLimit = containerWidth;

      // Move according to direction
      positionRef.current +=
        speed *
        deltaTime *
        directionRef.current;

      // ------------------------------------------------
      // Hit RIGHT side
      // ------------------------------------------------

      if (
        positionRef.current >= rightLimit
      ) {
        positionRef.current = rightLimit;

        // Change direction:
        // RIGHT -> LEFT
        directionRef.current = -1;

        console.log(
          "Announcement reached RIGHT side"
        );
        console.log(
          "Direction changed: RIGHT -> LEFT"
        );
      }

      // ------------------------------------------------
      // Hit LEFT side
      // ------------------------------------------------

      if (
        positionRef.current <= leftLimit
      ) {
        positionRef.current = leftLimit;

        // Change direction:
        // LEFT -> RIGHT
        directionRef.current = 1;

        console.log(
          "Announcement reached LEFT side"
        );
        console.log(
          "Direction changed: LEFT -> RIGHT"
        );
      }

      // Move element using JavaScript
      message.style.transform =
        `translateX(${positionRef.current}px)`;

      animationRef.current =
        requestAnimationFrame(animate);
    };

    // Start from LEFT side
    positionRef.current = -message.offsetWidth;

    // First direction:
    // LEFT -> RIGHT
    directionRef.current = 1;

    lastTime = performance.now();

    animationRef.current =
      requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(
          animationRef.current
        );
      }
    };
  }, [next]);

  // --------------------------------------------------
  // No holiday
  // --------------------------------------------------

  if (!next) {
    return null;
  }

  // --------------------------------------------------
  // Holiday date
  // --------------------------------------------------

  const dateLabel = new Date(
    next.startDate
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // --------------------------------------------------
  // Days remaining
  // --------------------------------------------------

  const d = daysUntil(next.startDate);

  const when =
    d <= 0
      ? "is today"
      : d === 1
        ? "is coming tomorrow"
        : `is coming in ${d} days`;

  // --------------------------------------------------
  // Final message
  // --------------------------------------------------

  const message =
    `${dateLabel}` +
    `${next.name ? ` — ${next.name}` : ""} ` +
    `${when}!`;

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <div
      className="
        hidden
        md:flex
        flex-1
        min-w-0
        px-2
        justify-end
      "
    >
      <div
        ref={containerRef}
        className="
          relative
          overflow-hidden
          h-6
          w-full
        "
      >
        <div
          ref={messageRef}
          className="
            absolute
            top-0
            left-0
            h-full
            flex
            items-center
            gap-2
            whitespace-nowrap
            text-sm
            font-medium
            text-amber-700
          "
        >
          <PartyPopper
            size={14}
            className="
              text-amber-500
              shrink-0
            "
          />

          <span>
            {message}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HolidayAnnouncement;

