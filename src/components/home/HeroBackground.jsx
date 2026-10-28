// @ts-nocheck
import { useEffect, useRef, useState } from 'react';

const HERO_VIDEO_SESSION_KEY = 'ada.heroVideoPlayed.v1';
const VIDEO_FADE_OUT_MS = 700;

function readSessionValue(/** @type {string} */ key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 */
function writeSessionValue(/** @type {string} */ key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore sessionStorage failures (private mode, security policies, etc.)
  }
}

function removeSessionValue(/** @type {string} */ key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore sessionStorage failures (private mode, security policies, etc.)
  }
}

function isReloadNavigation() {
  try {
    const [entry] = window.performance.getEntriesByType('navigation');
    // @ts-ignore
    return entry?.type === 'reload';
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function HeroBackground() {
  const videoRef = useRef(null);
  const fadeTimerRef = useRef(0);
  const [showVideo, setShowVideo] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (isReloadNavigation()) {
      removeSessionValue(HERO_VIDEO_SESSION_KEY);
    }

    if (prefersReducedMotion()) {
      return undefined;
    }

    const alreadyPlayed = readSessionValue(HERO_VIDEO_SESSION_KEY) === '1';
    if (!alreadyPlayed) {
      setShowVideo(true);
    }

    return () => {
      if (fadeTimerRef.current) {
        window.clearTimeout(fadeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showVideo) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        writeSessionValue(HERO_VIDEO_SESSION_KEY, '1');
        setIsFadingOut(false);
        setShowVideo(false);
      });
    }
  }, [showVideo]);

  const handleVideoEnded = () => {
    writeSessionValue(HERO_VIDEO_SESSION_KEY, '1');
    setIsFadingOut(true);
    fadeTimerRef.current = window.setTimeout(() => {
      setShowVideo(false);
      setIsFadingOut(false);
    }, VIDEO_FADE_OUT_MS);
  };

  const handleVideoError = () => {
    writeSessionValue(HERO_VIDEO_SESSION_KEY, '1');
    setIsFadingOut(false);
    setShowVideo(false);
  };

  const handleVideoPlay = () => {
    writeSessionValue(HERO_VIDEO_SESSION_KEY, '1');
  };

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <img
        src="/hero/ada-hero.webp"
        alt=""
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />

      {showVideo ? (
        <video
          ref={videoRef}
          src="/hero/ada-hero.mp4"
          className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}
          muted
          autoPlay
          playsInline
          preload="auto"
          onEnded={handleVideoEnded}
          onError={handleVideoError}
          onPlay={handleVideoPlay}
          aria-hidden="true"
        />
      ) : null}

      <div className="absolute inset-0 bg-slate-950/35" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.20)_0%,rgba(15,23,42,0.45)_55%,rgba(2,6,23,0.72)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/70 to-transparent" />
    </div>
  );
}
