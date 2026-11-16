import { Tag } from './components.jsx';
export default { title: 'Data Display/Tag', component: Tag, tags: ['autodocs'],
  argTypes: { type: { control: 'select', options: ['success', 'warning', 'error', 'info'], table: { defaultValue: { summary: 'success' } } } },
  args: { children: 'Label', type: 'success' } };
export const Usage = {};
