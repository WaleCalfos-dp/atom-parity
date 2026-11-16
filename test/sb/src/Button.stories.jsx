import React from 'react';
import { Button } from './components.jsx';
export default { title: 'Basics/Button', component: Button, tags: ['autodocs'],
  argTypes: {
    type: { control: 'select', options: ['primary', 'secondary', 'tertiary', 'destructive', 'inverse'], table: { defaultValue: { summary: 'primary' } } },
    size: { control: 'select', options: ['mini', 'small', 'middle', 'large'], table: { defaultValue: { summary: 'middle' } } },
    disabled: { control: 'boolean' }, loading: { control: 'boolean' }, onClick: { action: 'clicked' },
  },
  args: { children: 'Continue', type: 'primary', size: 'middle', disabled: false, loading: false },
};
export const Usage = {};
export const Sizes = { render: () => <div style={{ display: 'flex', gap: 8 }}><Button size="large" /><Button /><Button size="small" /></div> };
