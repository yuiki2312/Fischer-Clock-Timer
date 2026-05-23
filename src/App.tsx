"use client";

/**
 * REQUIREMENTS
 * - React 18+
 * - Next.js (App Router) / TypeScript
 * - Modern browser with Pointer Events support
 * - JavaScript enabled
 *
 * FEATURE REQUIREMENTS
 * - Fisher clock for up to 9 seats
 * - Tap a seat to move the turn there
 * - End turn button moves to the next seat
 * - Add increment on turn changes
 * - When a player reaches 0 with 対局時計モード on for the first time (not yet zeroed), they stay on their own seat and reset to the configurable zero-reset time (byo-yomi style); with the mode off, or on a later zero, the turn moves to the next seat
 * - Optional setting: after a player has hit 0 once, end-turn returns them to the zero-reset time instead of adding increment
 * - Undo for the last board-changing action
 * - Reorder seats by drag and drop on desktop and touch devices
 * - Edit each player time directly in minutes and seconds
 * - Settings panel for base time, increment, zero-reset time, player count, and the zero-after-0 toggle
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

type Player = {
  id: string;
  name: string;
  time: number;
  hasZeroed: boolean;
};

type TouchDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type Snapshot = {
  baseMinutes: string;
  incrementSeconds: string;
  preCountdownSeconds: string;
  zeroResetSeconds: string;
  playerCount: string;
  repeatZeroReset: boolean;
  turnPrepRemaining: number;
  players: Player[];
  activePlayerId: string | null;
  running: boolean;
  pausedFromPlayerId: string | null;
  draftTimes: Record<string, string>;
};

const DEFAULT_PLAYER_COUNT = 9;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;
const DRAG_THRESHOLD = 8;

function createId() {
  return `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseTimeInput(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(\d+):([0-5]?\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return items;
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  if (toIndex < 0 || toIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function makePlayers(count: number, baseSeconds: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: createId(),
    name: `Seat${index + 1}`,
    time: baseSeconds,
    hasZeroed: false,
  }));
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobile;
}

export default function FischerClockTimer() {
  const isMobile = useIsMobile();
  const [baseMinutes, setBaseMinutes] = useState<string>("10");
  const [incrementSeconds, setIncrementSeconds] = useState<string>("0");
  const [prevIncrementSeconds, setPrevIncrementSeconds] = useState<string>("0");
  const [preCountdownSeconds, setPreCountdownSeconds] = useState<string>("3");
  const [zeroResetSeconds, setZeroResetSeconds] = useState<string>("10");
  const [playerCount, setPlayerCount] = useState<string>(String(DEFAULT_PLAYER_COUNT));
  const [repeatZeroReset, setRepeatZeroReset] = useState<boolean>(true);
  const [players, setPlayers] = useState<Player[]>(() => makePlayers(DEFAULT_PLAYER_COUNT, 10 * 60));
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [pausedFromPlayerId, setPausedFromPlayerId] = useState<string | null>(null);
  const [turnPrepRemaining, setTurnPrepRemainingState] = useState<number>(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draftTimes, setDraftTimes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Snapshot[]>([]);

  const intervalRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(Date.now());
  const touchDragRef = useRef<TouchDragState | null>(null);
  const turnPrepRemainingRef = useRef<number>(0);

  // Keep a ref in sync so the running interval can read the latest prep value
  // without being torn down on every prep change.
  const setTurnPrepRemaining = (value: number) => {
    turnPrepRemainingRef.current = value;
    setTurnPrepRemainingState(value);
  };

  const baseSeconds = useMemo(() => {
    const value = Number(baseMinutes);
    return Math.max(0, Math.floor(Number.isNaN(value) ? 0 : value) * 60);
  }, [baseMinutes]);
  const zeroResetValue = useMemo(() => {
    const value = Number(zeroResetSeconds);
    return Math.max(0, Math.floor(Number.isNaN(value) ? 0 : value));
  }, [zeroResetSeconds]);
  const incrementValue = useMemo(() => {
    const value = Number(incrementSeconds);
    return Math.max(0, Math.floor(Number.isNaN(value) ? 0 : value));
  }, [incrementSeconds]);
  const preCountdownValue = useMemo(() => {
    const value = Number(preCountdownSeconds);
    return Math.max(0, Math.floor(Number.isNaN(value) ? 0 : value));
  }, [preCountdownSeconds]);

  const activePlayer = useMemo(() => players.find((p) => p.id === activePlayerId) ?? null, [players, activePlayerId]);
  const activeIndex = useMemo(() => players.findIndex((p) => p.id === activePlayerId), [players, activePlayerId]);

  const snapshot = (): Snapshot => ({
    baseMinutes,
    incrementSeconds,
    preCountdownSeconds,
    zeroResetSeconds,
    playerCount,
    repeatZeroReset,
    turnPrepRemaining: turnPrepRemainingRef.current,
    players: players.map((p) => ({ ...p })),
    activePlayerId,
    running,
    pausedFromPlayerId,
    draftTimes: { ...draftTimes },
  });

  const pushHistory = () => {
    setHistory((prev) => [...prev, snapshot()]);
  };

  const restoreSnapshot = (snap: Snapshot) => {
    setBaseMinutes(snap.baseMinutes);
    setIncrementSeconds(snap.incrementSeconds);
    setPreCountdownSeconds(snap.preCountdownSeconds);
    setZeroResetSeconds(snap.zeroResetSeconds);
    setPlayerCount(snap.playerCount);
    setRepeatZeroReset(snap.repeatZeroReset);
    setPlayers(snap.players.map((p) => ({ ...p })));
    setActivePlayerId(snap.activePlayerId);
    setRunning(snap.running);
    setPausedFromPlayerId(snap.pausedFromPlayerId);
    setDraftTimes({ ...snap.draftTimes });
    setDraggedId(null);
    setDropTargetId(null);
    setTurnPrepRemaining(snap.turnPrepRemaining);
    touchDragRef.current = null;
  };

  const undo = () => {
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      restoreSnapshot(last);
      return prev.slice(0, -1);
    });
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!running || !activePlayerId) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    lastTickRef.current = Date.now();
    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Pre-countdown (ディレイ): burn the prep time before the main clock ticks.
      // Handled outside the setPlayers updater so it stays a pure update and is
      // not double-applied under React StrictMode.
      let decrement = elapsed;
      if (turnPrepRemainingRef.current > 0) {
        const nextPrep = turnPrepRemainingRef.current - elapsed;
        if (nextPrep > 0) {
          setTurnPrepRemaining(nextPrep);
          return;
        }
        // Prep just ran out this tick; spill the leftover into the main time.
        setTurnPrepRemaining(0);
        decrement = -nextPrep;
        if (decrement <= 0) return;
      }

      setPlayers((prev) => {
        const index = prev.findIndex((p) => p.id === activePlayerId);
        if (index < 0) return prev;

        const current = prev[index];
        const nextTime = current.time - decrement;
        const next = [...prev];

        if (nextTime <= 0) {
          next[index] = { ...current, time: zeroResetValue, hasZeroed: true };

          if (repeatZeroReset && !current.hasZeroed) {
            setActivePlayerId(current.id);
            setPausedFromPlayerId(null);
            setTurnPrepRemaining(0);
            return next;
          }

          const nextIndexVal = (index + 1) % next.length;
          const nextPlayer = next[nextIndexVal];
          setActivePlayerId(nextPlayer?.id ?? null);
          setPausedFromPlayerId(null);
          setTurnPrepRemaining(preCountdownValue);
          return next;
        }

        next[index] = { ...current, time: nextTime };
        return next;
      });
    }, 100);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, activePlayerId, zeroResetValue, repeatZeroReset, preCountdownValue]);

  useEffect(() => {
    const ids = new Set(players.map((p) => p.id));
    setDraftTimes((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [pid, v] of Object.entries(prev)) {
        if (ids.has(pid)) next[pid] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (activePlayerId && !ids.has(activePlayerId)) {
      setActivePlayerId(null);
      setRunning(false);
      setPausedFromPlayerId(null);
      setTurnPrepRemaining(0);
    }
  }, [players, activePlayerId]);

  const resetClock = () => {
    pushHistory();
    setPlayers(makePlayers(players.length, baseSeconds));
    setDraftTimes({});
    setActivePlayerId(null);
    setRunning(false);
    setPausedFromPlayerId(null);
    setDraggedId(null);
    setDropTargetId(null);
    setTurnPrepRemaining(0);
    touchDragRef.current = null;
  };

  const applyPlayerCount = (nextCountRaw: string) => {
    const nextCountNum = Number(nextCountRaw);
    const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number.isNaN(nextCountNum) ? MIN_PLAYERS : nextCountNum));

    setPlayerCount(nextCountRaw);

    setPlayers((prev) => {
      if (prev.length === count) return prev;
      const next = prev.slice(0, count);
      while (next.length < count) {
        next.push({ id: createId(), name: `Seat${next.length + 1}`, time: baseSeconds, hasZeroed: false });
      }
      return next;
    });
  };

  const syncNamesAndTimes = () => {
    pushHistory();

    // タイマー値と0到達フラグをリセット
    setPlayers((prev) =>
      prev.map((player) => ({
        ...player,
        time: baseSeconds,
        hasZeroed: false,
      }))
    );

    // 下書きクリア
    setDraftTimes({});

    // 手番状態リセット
    setActivePlayerId(null);
    setRunning(false);
    setPausedFromPlayerId(null);
    setTurnPrepRemaining(0);

    // 設定タブを閉じる
    setShowSettings(false);
  };

  const pause = () => {
    setPausedFromPlayerId(activePlayerId);
    setRunning(false);
  };

  const resume = () => {
    if (activePlayerId) setRunning(true);
  };

  const moveToSeat = (targetPlayerId: string) => {
    const incrementSourceId = pausedFromPlayerId ?? activePlayerId;
    if (incrementSourceId && incrementSourceId === targetPlayerId && !pausedFromPlayerId) {
      return;
    }

    pushHistory();

    setPlayers((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((p) => p.id === incrementSourceId);
      if (sourceIndex >= 0) {
        const source = next[sourceIndex];
        const nextTime = repeatZeroReset && source.hasZeroed ? zeroResetValue : source.time + incrementValue;
        next[sourceIndex] = {
          ...source,
          time: nextTime,
        };
      }
      return next;
    });

    setActivePlayerId(targetPlayerId);
    setPausedFromPlayerId(null);
    setRunning(true);

    // Already-zeroed seats in 対局時計モード skip the pre-countdown.
    const targetPlayer = players.find((p) => p.id === targetPlayerId);
    const shouldSkipPrep = repeatZeroReset && targetPlayer?.hasZeroed;
    setTurnPrepRemaining(shouldSkipPrep ? 0 : preCountdownValue);
    lastTickRef.current = Date.now();
  };

  const endTurn = () => {
    if (!activePlayerId || players.length === 0) return;
    const next = players[(activeIndex + 1 + players.length) % players.length];
    if (!next) return;
    moveToSeat(next.id);
  };

  const addPlayer = () => {
    if (players.length >= MAX_PLAYERS) return;
    pushHistory();
    setPlayers((prev) => [
      ...prev,
      {
        id: createId(),
        name: `Seat${prev.length + 1}`,
        time: baseSeconds,
        hasZeroed: false,
      },
    ]);
    setPlayerCount((prev) => String(Math.min(MAX_PLAYERS, Number(prev || DEFAULT_PLAYER_COUNT) + 1)));
  };

  const removePlayer = (id: string) => {
    if (players.length <= MIN_PLAYERS) return;
    if (!players.some((p) => p.id === id)) return;
    pushHistory();
    const newLen = players.length - 1;
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    setPlayerCount(String(newLen));
  };

  const reorderPlayers = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    pushHistory();
    setPlayers((prev) => {
      const fromIndex = prev.findIndex((p) => p.id === fromId);
      const toIndex = prev.findIndex((p) => p.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      return moveItem(prev, fromIndex, toIndex);
    });
  };

  const startTouchDrag = (playerId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobile || event.pointerType === "mouse") return;

    const target = event.target as HTMLElement;

    // ☰ハンドル以外はドラッグ開始しない
    if (!target.closest(".drag-handle")) return;

    touchDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };

    setDraggedId(playerId);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveTouchDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = touchDragRef.current;
    if (!state || event.pointerType === "mouse") return;
    if (state.pointerId !== event.pointerId) return;
    if (!draggedId) return;

    const dx = Math.abs(event.clientX - state.startX);
    const dy = Math.abs(event.clientY - state.startY);
    if (!state.moved && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

    state.moved = true;

    const el = document.elementFromPoint(event.clientX, event.clientY);
    const card = el?.closest?.("[data-player-id]") as HTMLElement | null;
    const targetId = card?.dataset.playerId;
    if (!targetId || targetId === draggedId) return;

    setDropTargetId(targetId);
    reorderPlayers(draggedId, targetId);
  };

  const endTouchDrag = () => {
    touchDragRef.current = null;
    setDraggedId(null);
    setDropTargetId(null);
  };

  const onDragStart = (id: string) => setDraggedId(id);
  const onDragOver = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    setDropTargetId(targetId);
  };
  const onDrop = (targetId: string) => {
    if (!draggedId) return;
    reorderPlayers(draggedId, targetId);
    setDraggedId(null);
    setDropTargetId(null);
  };

  const commitPlayerTime = (playerId: string) => {
    const raw = draftTimes[playerId];
    const parsed = parseTimeInput(raw ?? "");
    if (parsed === null) return;

    setPlayers((prev) =>
      prev.map((player) => {
        if (player.id !== playerId) return player;

        const shouldClearZeroed = parsed > 0;
        return {
          ...player,
          time: parsed,
          hasZeroed: shouldClearZeroed ? false : player.hasZeroed,
        };
      })
    );

    setDraftTimes((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
  };

  const outerPad = isMobile ? 8 : 16;
  const tiny = isMobile ? 7 : 8;
  const actionPad = isMobile ? 8 : 10;
  const cardPad = isMobile ? 6 : 10;
  const timeFont = isMobile ? 20 : 30;
  const editFont = isMobile ? 12 : 13;

  const styles = {
    page: {
      minHeight: "100dvh",
      
      background: "#020617",
      color: "white",
      padding: outerPad,
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "flex",
      flexDirection: "column" as const,
      gap: isMobile ? 6 : 10,
      overflow: "auto",
      boxSizing: "border-box" as const,
    },
    activeActionBar: {
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.05)",
      borderRadius: 14,
      padding: actionPad,
      flexShrink: 0,
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      alignItems: "center",
      flexWrap: "wrap" as const,
      position: "sticky" as const,
      top: 0,
      zIndex: 20,
      backdropFilter: "blur(8px)",
    },
    main: {
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column" as const,
      overflow: "hidden",
    },
    board: {
      flex: 1,
      minHeight: 0,
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: isMobile ? 5 : 10,
      overflow: "hidden",
    },
    card: (isActive: boolean, isDropTarget: boolean, isTouchDragging: boolean): React.CSSProperties => ({
      minWidth: 0,
      border: `1px solid ${isActive ? "rgba(255,255,255,0.78)" : isDropTarget ? "rgba(96,165,250,0.95)" : "rgba(255,255,255,0.10)"}`,
      background: isDropTarget ? "rgba(59,130,246,0.10)" : "rgba(255,255,255,0.05)",
      borderRadius: 14,
      padding: cardPad,
      display: "flex",
      flexDirection: "column",
      gap: isMobile ? 4 : 7,
      boxShadow: "0 10px 20px rgba(0,0,0,0.18)",
      overflow: "hidden",
      touchAction: "none",
      cursor: "pointer",
      justifyContent: "space-between",
      opacity: isTouchDragging ? 0.65 : 1,
      transform: isTouchDragging ? "scale(0.98)" : "none",
      position: "relative",
    }),
    nameInput: {
      width: "100%",
      minWidth: 0,
      boxSizing: "border-box" as const,
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.06)",
      color: "white",
      padding: isMobile ? "5px 6px" : "9px 10px",
      fontSize: isMobile ? 11 : 13,
    },
    tinyButton: {
      border: "1px solid rgba(255,255,255,0.16)",
      background: "rgba(255,255,255,0.08)",
      color: "white",
      padding: `${tiny}px ${tiny + 3}px`,
      borderRadius: 10,
      cursor: "pointer",
      fontSize: isMobile ? 12 : 13,
      lineHeight: 1,
      whiteSpace: "nowrap" as const,
    },
    turnButton: {
      border: "1px solid rgba(255,255,255,0.18)",
      color: "white",
      padding: isMobile ? "10px 14px" : "12px 18px",
      borderRadius: 12,
      cursor: "pointer",
      fontSize: isMobile ? 14 : 16,
      fontWeight: 700,
      whiteSpace: "nowrap" as const,
      boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
    },
    turnPrimary: {
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(34,197,94,0.22)",
      color: "white",
      padding: isMobile ? "12px 18px" : "16px 26px",
      borderRadius: 14,
      cursor: "pointer",
      fontSize: isMobile ? 16 : 18,
      fontWeight: 800,
      whiteSpace: "nowrap" as const,
      minWidth: isMobile ? 120 : 160,
      boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
    },
    time: {
      fontSize: timeFont,
      fontWeight: 800,
      fontVariantNumeric: "tabular-nums",
      lineHeight: 1,
      textAlign: "center" as const,
      marginTop: 1,
    },
    timeEditRow: {
      display: "flex",
      gap: 4,
    },
    timeEdit: {
      width: "50%",
      boxSizing: "border-box" as const,
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.06)",
      color: "white",
      padding: isMobile ? "5px 6px" : "7px 10px",
      fontSize: editFont,
      textAlign: "center" as const,
      minWidth: 0,
    },
    removeButton: {
      position: "absolute" as const,
      top: 4,
      right: 4,
      border: "none",
      background: "rgba(239,68,68,0.92)",
      color: "white",
      borderRadius: "50%",
      width: isMobile ? 22 : 24,
      height: isMobile ? 22 : 24,
      fontSize: isMobile ? 12 : 13,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
    settingsPanel: {
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.05)",
      borderRadius: 14,
      padding: isMobile ? 8 : 12,
      flexShrink: 0,
    },
    settingsGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
      gap: 10,
    },
    field: {
      display: "grid",
      gap: 6,
      fontSize: 13,
      color: "#cbd5e1",
    },
    checkboxRow: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      minHeight: 40,
      paddingTop: 22,
      color: "#cbd5e1",
      fontSize: 13,
    },
    input: {
      width: "100%",
      boxSizing: "border-box" as const,
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.06)",
      color: "white",
      padding: isMobile ? "7px 8px" : "10px 12px",
      fontSize: isMobile ? 13 : 14,
    },
    settingsButton: {
      border: "1px solid rgba(255,255,255,0.16)",
      background: "rgba(255,255,255,0.08)",
      color: "white",
      padding: isMobile ? "7px 9px" : "9px 12px",
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 13,
    },
  };

  return (
    <div style={styles.page}>
      <section style={styles.activeActionBar}>
        <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", alignItems: "center", width: "100%" }}>
          <button type="button" style={{ ...styles.tinyButton, color: "white" }} onClick={addPlayer} disabled={players.length >= MAX_PLAYERS}>
            ➕
          </button>
          <button type="button" style={styles.tinyButton} onClick={() => setShowSettings((v) => !v)}>
            ⚙️
          </button>
          <button type="button" style={styles.tinyButton} onClick={undo} disabled={history.length === 0}>
            ↩
          </button>
          <span style={{ color: "#cbd5e1", fontSize: isMobile ? 12 : 14 }}>
            手番中: <strong style={{ color: "white" }}>{activePlayer ? activePlayer.name : "未開始"}</strong>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" style={{ ...styles.turnButton, background: "rgba(239,68,68,0.35)" }} onClick={pause} disabled={!running || !activePlayerId}>
            一時停止
          </button>
          <button type="button" style={{ ...styles.turnButton, background: "rgba(59,130,246,0.35)" }} onClick={resume} disabled={running || !activePlayerId}>
            再開
          </button>
          <button type="button" style={styles.turnPrimary} onClick={endTurn} disabled={!activePlayerId}>
            隣のシートへ
          </button>
        </div>
      </section>

      {showSettings ? (
        <section style={styles.settingsPanel}>
          <div style={styles.settingsGrid}>
            <label style={styles.field}>
              <span>持ち時間（分）</span>
              <input type="number" min={0} value={baseMinutes} onChange={(e) => setBaseMinutes(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span>インクリメント（秒）</span>
              <input type="number" min={0} value={incrementSeconds} onChange={(e) => setIncrementSeconds(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span>ディレイ（秒）</span>
              <input type="number" min={0} value={preCountdownSeconds} onChange={(e) => setPreCountdownSeconds(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span>0秒時リセット（秒）</span>
              <input type="number" min={0} value={zeroResetSeconds} onChange={(e) => setZeroResetSeconds(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span>人数</span>
              <input
                type="number"
                min={MIN_PLAYERS}
                max={MAX_PLAYERS}
                value={playerCount}
                onChange={(e) => applyPlayerCount(e.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={repeatZeroReset}
                onChange={(e) => {
                const checked = e.target.checked;
                setRepeatZeroReset(checked);
                if (checked) {
                  setPrevIncrementSeconds(incrementSeconds);
                  setIncrementSeconds("0");
                } else {
                  setIncrementSeconds(prevIncrementSeconds);
                }
              }}
              />
              <span>対局時計モードにする</span>
            </label>
            <label style={styles.field}>
              <span>操作</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={styles.settingsButton} onClick={syncNamesAndTimes}>
                  新規対局
                </button>
                <button
                  type="button"
                  style={styles.settingsButton}
                  onClick={() => setShowSettings(false)}
                >
                  閉じる
                </button>
              </div>
            </label>
          </div>
        </section>
      ) : null}

      <section style={styles.main}>
        <div style={styles.board}>
          {players.map((player, index) => {
            const isActive = activePlayerId === player.id && running;
            const isDropTarget = dropTargetId === player.id;
            const isTouchDragging = draggedId === player.id && isMobile;
            const draft = draftTimes[player.id];
            const [draftMin, draftSec] = (draft ?? "").split(":");
            const displayMin = draft !== undefined ? (draftMin ?? "") : String(Math.floor(player.time / 60));
            const displaySec = draft !== undefined ? (draftSec ?? "") : String(Math.floor(player.time % 60)).padStart(2, "0");
            const showPrep = activePlayerId === player.id && turnPrepRemaining > 0;
            const isZeroedStyle = repeatZeroReset && player.hasZeroed;

            return (
              <div
                key={player.id}
                data-player-id={player.id}
                style={styles.card(isActive, isDropTarget, isTouchDragging)}
                draggable={!isMobile}
                onPointerDown={(e) => startTouchDrag(player.id, e)}
                onPointerMove={moveTouchDrag}
                onPointerUp={endTouchDrag}
                onPointerCancel={endTouchDrag}
                onDragStart={() => onDragStart(player.id)}
                onDragOver={(e) => onDragOver(e, player.id)}
                onDrop={() => onDrop(player.id)}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDropTargetId(null);
                }}
                onClick={() => {
                  if (touchDragRef.current?.moved) return;
                  moveToSeat(player.id);
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePlayer(player.id);
                  }}
                  style={styles.removeButton}
                  aria-label={`Seat ${index + 1} を削除`}
                >
                  ✕
                </button>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="drag-handle" style={{ cursor: "grab", userSelect: "none", fontSize: isMobile ? 13 : 16 }} title="ドラッグして並び替え">
                    ☰
                  </span>
                  <input
                    value={player.name}
                    onChange={(e) => setPlayers((prev) => prev.map((pl) => (pl.id === player.id ? { ...pl, name: e.target.value } : pl)))}
                    onClick={(e) => e.stopPropagation()}
                    style={styles.nameInput}
                    aria-label={`Seat ${index + 1} の名前`}
                  />
                </div>

                <div style={{ ...styles.time, color: showPrep ? "#f59e0b" : isZeroedStyle ? "#ef4444" : "white" }}>
                  {showPrep ? `${Math.ceil(turnPrepRemaining)}` : formatTime(player.time)}
                </div>

                <div style={styles.timeEditRow} onClick={(e) => e.stopPropagation()}>
                  <input
                    value={displayMin}
                    onChange={(e) => {
                      const sec = String(Math.floor(player.time % 60)).padStart(2, "0");
                      setDraftTimes((prev) => ({
                        ...prev,
                        [player.id]: `${e.target.value}:${sec}`,
                      }));
                    }}
                    onBlur={() => commitPlayerTime(player.id)}
                    placeholder="分"
                    inputMode="numeric"
                    style={styles.timeEdit}
                    aria-label={`Seat ${index + 1} の分`}
                  />
                  <input
                    value={displaySec}
                    onChange={(e) => {
                      let sec = e.target.value;
                      if (sec === "") {
                        setDraftTimes((prev) => ({
                          ...prev,
                          [player.id]: `${displayMin}:`,
                        }));
                        return;
                      }
                      if (Number(sec) > 59) sec = "59";
                      setDraftTimes((prev) => ({
                        ...prev,
                        [player.id]: `${displayMin}:${sec}`,
                      }));
                    }}
                    onBlur={() => commitPlayerTime(player.id)}
                    placeholder="秒"
                    inputMode="numeric"
                    style={styles.timeEdit}
                    aria-label={`Seat ${index + 1} の秒`}
                  />
                </div>

                <div style={{ color: isActive ? "#86efac" : "#94a3b8", fontSize: isMobile ? 10 : 12, minHeight: 12 }}>
                  {isActive ? "▶ 進行中" : draggedId === player.id ? "移動中" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
