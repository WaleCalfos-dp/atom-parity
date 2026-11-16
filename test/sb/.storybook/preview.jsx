import React from 'react';
import '../src/tokens.css';
import '../src/components.css';
export default {
  globalTypes: {
    locale: { description: 'Internationalization locale', toolbar: { items: [{ value: 'en-US', title: 'English' }, { value: 'zh-CN', title: '中文' }] } },
    biz: { description: 'Business type', toolbar: { items: [{ value: 'global-app', title: 'Global App' }, { value: 'master-card', title: 'Master Card' }, { value: 'investec', title: 'Investec' }] } },
    direction: { description: 'Text direction', toolbar: { items: [{ value: 'ltr', title: 'LTR' }, { value: 'rtl', title: 'RTL' }] } },
  },
  initialGlobals: { biz: 'global-app', locale: 'en-US', direction: 'ltr' },
  decorators: [(Story, ctx) => <div className={`aum-ctx aum-${ctx.globals.biz}`} data-biz={ctx.globals.biz} dir={ctx.globals.direction} style={{ padding: 16 }}><Story /></div>],
  parameters: { layout: 'fullscreen' },
};
