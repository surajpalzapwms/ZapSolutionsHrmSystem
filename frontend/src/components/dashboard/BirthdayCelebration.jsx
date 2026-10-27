// src/components/dashboard/BirthdayCelebration.jsx
//
// Dashboard card: today's birthdays + the next few upcoming ones.
// From 12:00 midnight (India time) on someone's birthday, everybody else
// gets a "🎉 Wish" button. It opens a party modal — balloons, cake,
// confetti, gifts — where they can pick a ready-made wish or write their
// own message. The birthday person sees how many colleagues wished them and
// can read every message. Same data as the mobile app.
//
// The card reloads by itself at midnight, so the Wish button appears at
// 12:00 without refreshing the page.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { birthdayService } from "../../services/birthdayService";
import { fileUrl } from "../../services/documentService";
import { showToast } from "../../utils/toast";

const PINK = "#BE185D";
const MAX = 300;
const PARTY = ["🎈", "🎉", "🎂", "🎁", "🥳", "🎊", "🍰", "✨", "🎈", "🎀", "🧁", "🎉"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const firstName = (n) => String(n || "").split(" ")[0] || "friend";
const dayMonth = (ymd) => {
  const [, m, d] = String(ymd || "").split("-").map(Number);
  return d ? `${d} ${MONTHS[(m || 1) - 1]}` : "";
};
const whenLabel = (n) => (n === 0 ? "Today 🎉" : n === 1 ? "Tomorrow" : `in ${n} days`);

// Milliseconds until the next 12:00 midnight in India.
const msToIstMidnight = () => {
  const now = new Date();
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  const next = new Date(ist);
  next.setHours(24, 0, 5, 0);
  return Math.max(next - ist, 60000);
};

const PARTY_CSS = `
@keyframes bdayFloat { 0%,100% { transform: translateY(0) rotate(-8deg); opacity:.7 } 50% { transform: translateY(-10px) rotate(8deg); opacity:1 } }
@keyframes bdayBurst { 0% { transform: translate(0,0) scale(.6); opacity:1 } 100% { transform: translate(var(--dx), var(--dy)) scale(1.1); opacity:0 } }
.bday-float { animation: bdayFloat 2.8s ease-in-out infinite; }
.bday-burst { animation: bdayBurst 1.2s ease-out forwards; }
`;

const Photo = ({ name, url, size = 40 }) => {
  const [broken, setBroken] = useState(false);
  const initials = String(name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (url && !broken) {
    return (
      <img
        src={fileUrl(url)}
        alt={name}
        onError={() => setBroken(true)}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{ width: size, height: size, background: "#FCE7F3", color: PINK, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
};

// ── The party modal ──────────────────────────────────────────────────────
const WishModal = ({ person, onClose, onWished }) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const first = firstName(person?.staffName);
  const quick = [
    `Happy Birthday, ${first}! 🎂`,
    `Many many happy returns of the day, ${first}! 🎉`,
    "Wishing you a fantastic year ahead! 🥳",
    `Have a blast today, ${first}! 🎈🎁`,
  ];

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const res = await birthdayService.wish(person._id, text.trim() || `Happy Birthday, ${first}! 🎂`);
      setSent(true);
      onWished({ ...person, wishedByMe: true, wishCount: res.data?.data?.wishCount ?? (person.wishCount || 0) + 1 });
      setTimeout(onClose, 1800);
    } catch (err) {
      showToast("error", err.response?.data?.message || "Couldn't send your wish");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <style>{PARTY_CSS}</style>
      <div className="relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl" style={{ background: "#FFF5FA" }}>
        {/* Party header */}
        <div className="relative text-center text-white pt-7 pb-14 overflow-hidden" style={{ background: `linear-gradient(135deg, ${PINK}, #DB2777 55%, #F472B6)` }}>
          {PARTY.map((icon, i) => (
            <span
              key={i}
              className="bday-float absolute text-xl select-none pointer-events-none"
              style={{ left: `${3 + (Math.floor(i / 2) * 15)}%`, top: i % 2 ? 4 : 98, animationDelay: `${i * 0.15}s` }}
            >
              {icon}
            </span>
          ))}
          <p className="relative text-xs font-bold tracking-widest opacity-90 mt-3">IT&apos;S A CELEBRATION!</p>
          <h3 className="relative text-2xl font-extrabold mt-1 px-8">🎂 Happy Birthday, {first}! 🎉</h3>
          <button type="button" onClick={onClose} className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/25 hover:bg-white/40 flex items-center justify-center" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="relative z-10 flex flex-col items-center -mt-11">
          <div className="rounded-full border-4 border-white bg-white">
            <Photo name={person.staffName} url={person.photoUrl} size={84} />
          </div>
          <p className="font-bold text-gray-800 mt-2">{person.staffName}</p>
          {person.projectName ? <p className="text-xs text-gray-500">{person.projectName}</p> : null}
        </div>

        {sent ? (
          <div className="relative text-center px-6 py-8">
            {Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className="bday-burst absolute left-1/2 top-6 text-xl pointer-events-none"
                style={{ "--dx": `${(i % 9) * 26 - 104}px`, "--dy": `${(i % 2 ? -1 : 1) * (40 + (i % 5) * 18)}px`, animationDelay: `${i * 0.03}s` }}
              >
                {["🎉", "🎊", "✨", "🎈", "💖"][i % 5]}
              </span>
            ))}
            <p className="text-5xl">🥳</p>
            <p className="font-extrabold mt-2" style={{ color: PINK }}>
              Wish sent!
            </p>
            <p className="text-sm text-gray-500 mt-1">{first} will see your message on their birthday card.</p>
          </div>
        ) : (
          <div className="p-5 pt-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">Pick a wish or write your own</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {quick.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setText(w)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                  style={text === w ? { background: PINK, color: "#fff", borderColor: PINK } : { background: "#fff", color: PINK, borderColor: "#FBCFE8" }}
                >
                  {w}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              rows={4}
              autoFocus
              placeholder={`Write something nice for ${first}… 🎈`}
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: "#FBCFE8" }}
            />
            <p className="text-[11px] text-gray-400 text-right">
              {text.length}/{MAX}
            </p>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="mt-2 w-full py-3 rounded-xl text-white font-bold disabled:opacity-60"
              style={{ background: PINK }}
            >
              {sending ? "Sending…" : "🎉 Send birthday wish"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── The birthday person's own wishes ─────────────────────────────────────
const MyWishesModal = ({ onClose }) => {
  const [wishes, setWishes] = useState(null);
  useEffect(() => {
    birthdayService
      .getMyWishes()
      .then((res) => setWishes(res.data?.data || []))
      .catch(() => setWishes([]));
  }, []);
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md max-h-[80vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl" style={{ background: "#FFF5FA" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#FBCFE8" }}>
          <h3 className="font-extrabold" style={{ color: PINK }}>
            💌 Your birthday wishes
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {wishes === null ? (
            <p className="text-center text-sm text-gray-400 py-6">Loading…</p>
          ) : wishes.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">No wishes yet — they&apos;re on the way! 🎈</p>
          ) : (
            wishes.map((w) => (
              <div key={w._id} className="flex gap-3 bg-white rounded-2xl border p-3" style={{ borderColor: "#FBCFE8" }}>
                <Photo name={w.fromName} url={w.photoUrl} size={38} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800">{w.fromName}</p>
                  <p className="text-sm text-gray-700 break-words">{w.message || "Happy Birthday! 🎂"}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/** Props: limit (how many upcoming birthdays to list, default 5), className */
const BirthdayCelebration = ({ limit = 5, className = "" }) => {
  const [list, setList] = useState(null);
  const [wishFor, setWishFor] = useState(null);
  const [myWishesOpen, setMyWishesOpen] = useState(false);

  const load = useCallback(() => {
    birthdayService
      .getUpcoming(60)
      .then((res) => setList(res.data?.data || []))
      .catch(() => setList((cur) => cur || []));
  }, []);

  useEffect(() => {
    load();
    // Reload at 12:00 midnight (India) so the Wish button shows up on time.
    let timer;
    const arm = () => {
      timer = setTimeout(() => {
        load();
        arm();
      }, msToIstMidnight());
    };
    arm();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const today = useMemo(() => (list || []).filter((b) => b.daysUntil === 0), [list]);
  const upcoming = useMemo(() => (list || []).filter((b) => b.daysUntil > 0).slice(0, limit), [list, limit]);
  const mine = today.find((b) => b.isSelf);
  const others = today.filter((b) => !b.isSelf);

  const onWished = (u) => setList((cur) => (cur || []).map((b) => (String(b._id) === String(u._id) ? { ...b, ...u } : b)));

  if (!list || (!today.length && !upcoming.length)) return null;

  return (
    <div className={`flex-shrink-0 space-y-3 ${className}`}>
      <style>{PARTY_CSS}</style>
      {mine && (
        <div className="relative overflow-hidden rounded-2xl text-white px-6 py-4 shadow-sm flex flex-wrap items-center justify-between gap-3" style={{ background: `linear-gradient(135deg, ${PINK}, #DB2777 55%, #F472B6)` }}>
          {["🎈", "🎉", "🎁", "🎊", "✨", "🎈"].map((icon, i) => (
            <span key={i} className="bday-float absolute text-xl pointer-events-none opacity-80" style={{ right: `${4 + i * 7}%`, top: i % 2 ? 6 : 34, animationDelay: `${i * 0.2}s` }}>
              {icon}
            </span>
          ))}
          <div className="relative">
            <p className="text-2xl">🎉🎂</p>
            <h3 className="text-xl font-extrabold">Happy Birthday, {firstName(mine.staffName)}!</h3>
            <p className="text-sm opacity-90">Wishing you a wonderful day — the whole team is celebrating with you. 🥳</p>
          </div>
          <button type="button" onClick={() => setMyWishesOpen(true)} className="relative px-4 py-2 rounded-full text-sm font-bold bg-white/20 hover:bg-white/30 border border-white/50">
            💌 {mine.wishCount ? `${mine.wishCount} wish${mine.wishCount === 1 ? "" : "es"} — read them` : "See your wishes"}
          </button>
        </div>
      )}

      {others.length > 0 && (
        <div className="rounded-2xl border px-5 py-4" style={{ background: "#FFF7ED", borderColor: "#FED7AA" }}>
          <p className="font-bold text-orange-800 mb-2">🎂 Birthday today!</p>
          <div className="space-y-2">
            {others.map((b) => (
              <div key={b._id} className="flex items-center gap-3">
                <Photo name={b.staffName} url={b.photoUrl} size={38} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-orange-900">
                    Today is <b>{b.staffName}</b>&apos;s birthday — wish them and celebrate! 🥳
                  </p>
                  {b.wishCount ? (
                    <p className="text-[11px]" style={{ color: PINK }}>
                      {b.wishCount} wish{b.wishCount === 1 ? "" : "es"} so far
                    </p>
                  ) : null}
                </div>
                {b.wishedByMe ? (
                  <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Wished ✓</span>
                ) : b.canWish !== false ? (
                  <button type="button" onClick={() => setWishFor(b)} className="px-4 py-1.5 rounded-full text-xs font-extrabold text-white shadow-sm hover:opacity-90" style={{ background: PINK }}>
                    🎉 Wish
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-800">🎂 Upcoming Birthdays</h3>
          </div>
          <ul className="flex gap-4 overflow-x-auto px-5 py-3">
            {upcoming.map((b) => (
              <li key={b._id} className="flex items-center gap-2 flex-shrink-0">
                <Photo name={b.staffName} url={b.photoUrl} size={36} />
                <div>
                  <p className="text-sm font-medium text-gray-800 whitespace-nowrap">
                    {b.staffName}
                    {b.isSelf ? " (You)" : ""}
                  </p>
                  <p className="text-xs text-gray-400 whitespace-nowrap">
                    {dayMonth(b.date)} · <span style={{ color: PINK }}>{whenLabel(b.daysUntil)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {wishFor && <WishModal person={wishFor} onClose={() => setWishFor(null)} onWished={onWished} />}
      {myWishesOpen && <MyWishesModal onClose={() => setMyWishesOpen(false)} />}
    </div>
  );
};

export default BirthdayCelebration;
