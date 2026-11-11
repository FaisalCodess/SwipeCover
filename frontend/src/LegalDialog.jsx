import { useCallback, useEffect, useRef, useState } from 'react';
import { HeartHandshake, Lock, Mail, Play, Trash2, UserRound, X } from 'lucide-react';
import { BoardFrame } from './MainMenu.jsx';
import { ResultButton } from './ResultDialog.jsx';
import { fetchConfig } from './api.js';
import { LEGAL, LEGAL_CONTACT, LEGAL_UPDATED } from './legalContent.js';
import './result.css';
import './auth.css';
import './legal.css';

const ICONS = { lock: Lock, mail: Mail, trash: Trash2, play: Play, user: UserRound, heart: HeartHandshake };
const CLOSE_MS = 200;
const SWAP_MS = 150;

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// "Label — text" shows the label in bold; anything else is plain text.
function ListItem({ text }) {
  const split = text.indexOf(' — ');
  if (split === -1) return <li>{text}</li>;
  return (
    <li>
      <b>{text.slice(0, split)}</b>
      {' — '}
      {text.slice(split + 3)}
    </li>
  );
}

function Block({ block }) {
  if (Array.isArray(block)) return <ul>{block.map((item) => <ListItem key={item} text={item} />)}</ul>;
  return <p>{block}</p>;
}

// The Privacy Policy and the Terms of Use, as a panel inside the game instead of a page of their own.
// Nothing navigates away, so the game (and its music) carries on untouched underneath.
export default function LegalDialog({ initial = 'privacy', onClose }) {
  const [tab, setTab] = useState(LEGAL[initial] ? initial : 'privacy');
  const [closing, setClosing] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [contact, setContact] = useState(LEGAL_CONTACT);
  const [active, setActive] = useState(null);
  const [progress, setProgress] = useState(0);
  const scroller = useRef(null);
  const panel = useRef(null);
  const timers = useRef([]);
  const doc = LEGAL[tab];

  const later = (callback, delay) => {
    timers.current.push(window.setTimeout(callback, delay));
  };

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const close = useCallback(() => {
    if (closing) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    later(onClose, CLOSE_MS);
  }, [closing, onClose]);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then((config) => setContact(config.contact_email || LEGAL_CONTACT))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  // How far down the reader is, and which section they are in.
  const track = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const room = box.scrollHeight - box.clientHeight;
    setProgress(room > 0 ? Math.min(1, box.scrollTop / room) : 1);
    let current = null;
    box.querySelectorAll('[data-legal-section]').forEach((section) => {
      if (section.offsetTop - 90 <= box.scrollTop || (room > 0 && room - box.scrollTop < 4)) current = section.dataset.legalSection;
    });
    setActive(current);
  }, []);

  useEffect(() => {
    track();
    window.addEventListener('resize', track);
    return () => window.removeEventListener('resize', track);
  }, [tab, track]);

  function selectTab(next) {
    if (next === tab || swapping || closing) return;
    if (prefersReducedMotion()) {
      setTab(next);
      scroller.current?.scrollTo({ top: 0 });
      return;
    }
    setSwapping(true);
    later(() => {
      setTab(next);
      scroller.current?.scrollTo({ top: 0 });
      setSwapping(false);
    }, SWAP_MS);
  }

  function jumpTo(id) {
    const box = scroller.current;
    const target = box?.querySelector(`[data-legal-section="${id}"]`);
    if (box && target) box.scrollTo({ top: target.offsetTop - 8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  const sections = doc.sections;
  const navItems = [...sections, { id: 'contact', title: 'Contact' }];
  const activeId = active || sections[0].id;

  return (
    <div
      className={`result-overlay legal-overlay fade-in ${closing ? 'is-closing' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        className={`result-panel legal-panel pop-in is-level ${closing ? 'is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
      >
        <BoardFrame />
        <button type="button" className="auth-close legal-close" onClick={close} aria-label="Close">
          <X size={16} strokeWidth={1.6} />
        </button>

        <div className="legal-body">
          <header className="legal-head">
            <div>
              <p className="result-kicker">{doc.kicker}</p>
              <h2 id="legal-title" className="legal-title">{doc.title}</h2>
            </div>
            <div className="legal-tabs" role="tablist" aria-label="Legal documents">
              <i className="legal-tab-glider" style={{ transform: `translateX(${tab === 'terms' ? 100 : 0}%)` }} />
              {Object.entries(LEGAL).map(([id, entry]) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={`legal-tab ${tab === id ? 'is-active' : ''}`}
                  onClick={() => selectTab(id)}
                >
                  {entry.tab.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <div className="legal-progress" aria-hidden="true">
            <i style={{ transform: `scaleX(${progress})` }} />
          </div>

          <div className="legal-main">
            <nav className="legal-nav" aria-label="Sections">
              <ol>
                {navItems.map((section, index) => (
                  <li key={`${tab}-${section.id}`}>
                    <button type="button" className={activeId === section.id ? 'is-active' : ''} onClick={() => jumpTo(section.id)}>
                      <small>{String(index + 1).padStart(2, '0')}</small>
                      <span>{section.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="legal-scroll" ref={scroller} onScroll={track} tabIndex={0} aria-label={`${doc.title}, scrollable`}>
              <article key={tab} className={`legal-doc ${swapping ? 'is-leaving' : ''}`}>
                <p className="legal-intro" style={{ '--i': 0 }}>{doc.intro}</p>

                <ul className="legal-summary" style={{ '--i': 1 }}>
                  {doc.summary.map((card, index) => {
                    const Icon = ICONS[card.icon] || Lock;
                    return (
                      <li key={card.title} style={{ '--k': index }}>
                        <span className="legal-summary-icon"><Icon size={16} strokeWidth={1.6} /></span>
                        <strong>{card.title}</strong>
                        <span>{card.text}</span>
                      </li>
                    );
                  })}
                </ul>

                {sections.map((section, index) => (
                  <section key={section.id} className="legal-section" data-legal-section={section.id} style={{ '--i': Math.min(index + 2, 9) }}>
                    <h3>
                      <small>{String(index + 1).padStart(2, '0')}</small>
                      {section.title}
                    </h3>
                    {section.blocks.map((block, blockIndex) => <Block key={blockIndex} block={block} />)}
                  </section>
                ))}

                <section className="legal-section legal-contact" data-legal-section="contact" style={{ '--i': 9 }}>
                  <h3>
                    <small>{String(sections.length + 1).padStart(2, '0')}</small>
                    Contact
                  </h3>
                  {contact ? (
                    <p>
                      Questions, requests or something to report? Write to <a href={`mailto:${contact}`}>{contact}</a>.
                    </p>
                  ) : (
                    <p>Questions, requests or something to report? Write to the contact address for this site.</p>
                  )}
                </section>
              </article>
            </div>
          </div>

          <footer className="legal-foot">
            <span className="legal-foot-note">
              <span>LAST UPDATED · {LEGAL_UPDATED.toUpperCase()}</span>
              {contact && <a href={`mailto:${contact}`}>{contact}</a>}
            </span>
            <ResultButton primary onClick={close}>BACK TO THE GAME</ResultButton>
          </footer>
        </div>
      </section>
    </div>
  );
}
