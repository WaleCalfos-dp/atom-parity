import React, { useState } from 'react';

export const Button = ({ children = 'Continue', type = 'primary', size = 'middle', disabled = false, loading = false, onClick }) => (
  <button className={`aum-button aum-button--${type} aum-button--${size}`} disabled={disabled} onClick={onClick}>{loading ? 'Loading…' : children}</button>
);
export const Tag = ({ children = 'Label', type = 'success' }) => <span className={`aum-tag aum-tag--${type}`}>{children}</span>;
export const Collapse = ({ title = 'Lounge access', expanded = false }) => {
  const [open, setOpen] = useState(expanded);
  return (
    <div className="aum-collapse">
      <button className="aum-collapse__header" aria-expanded={open} onClick={() => setOpen(!open)}>{title}<span aria-hidden>{open ? '−' : '+'}</span></button>
      {open && <div className="aum-collapse__body">Two guests included with your membership.</div>}
    </div>
  );
};
export const Switch = ({ checked = false, disabled = false }) => <button className="aum-switch" role="switch" aria-checked={checked} aria-label="Notifications" disabled={disabled} />;
export const Alert = ({ children = 'Your booking is confirmed.' }) => <div className="aum-alert" role="status">{children}</div>;

