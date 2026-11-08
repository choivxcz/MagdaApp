import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { setPrefs, usePrefs } from '../lib/prefs.js';

const SLIDES = [
  {
    icon: 'bus',
    title: 'See jeepneys live',
    text: 'Watch jeepneys on the Magdalena – Santa Cruz route move on the map, and know when the next one reaches you.',
  },
  {
    icon: 'seat',
    title: 'Know if there’s a seat',
    text: 'Drivers update how many seats are free, so you can skip the full ones and wait for one with space.',
  },
  {
    icon: 'fare',
    title: 'Know your fare',
    text: 'Pick your drop-off and see the estimated fare before you ride, including student, senior and PWD discounts.',
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const prefs = usePrefs();
  const onFareStep = step === SLIDES.length;

  return (
    <div className="onboarding">
      <div className="onboarding-body">
        {!onFareStep ? (
          <>
            <div className="hero-icon"><Icon name={SLIDES[step].icon} size={56} /></div>
            <h1>{SLIDES[step].title}</h1>
            <p>{SLIDES[step].text}</p>
          </>
        ) : (
          <>
            <h1>Choose your fare type</h1>
            <p>We’ll show fares for this type first.</p>
            <div className="choice-list">
              {[
                ['regular', 'Regular', 'Standard fare'],
                ['discounted', 'Discounted', 'Student, Senior Citizen or PWD (20% off)'],
              ].map(([id, title, sub]) => (
                <button key={id} className={`choice ${prefs.fareType === id ? 'on' : ''}`} onClick={() => setPrefs({ fareType: id })}>
                  <span className="radio" />
                  <span><b>{title}</b><small>{sub}</small></span>
                </button>
              ))}
            </div>
            <p className="hint">You can change this later in More → Preferences.</p>
          </>
        )}
      </div>

      <div className="onboarding-foot">
        <div className="dots">
          {[...SLIDES, null].map((_, i) => <i key={i} className={i === step ? 'on' : ''} />)}
        </div>
        <button className="btn primary wide" onClick={() => (onFareStep ? setPrefs({ onboarded: true }) : setStep(step + 1))}>
          {onFareStep ? 'Continue' : 'Next'}
        </button>
        {!onFareStep && (
          <button className="link-btn" onClick={() => setStep(SLIDES.length)}>Skip</button>
        )}
      </div>
    </div>
  );
}
