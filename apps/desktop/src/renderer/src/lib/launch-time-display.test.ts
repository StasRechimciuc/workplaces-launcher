import { describe, expect, it } from 'vitest';
import type { TimingDisplay } from '../../../preload';
import {
  stepLaunchTimeTooltip,
  workspaceLaunchTimeLabel,
  workspaceLaunchTimeTooltip,
} from './launch-time-display';

describe('workspaceLaunchTimeLabel', () => {
  it('renders no-steps as-is, with no suffix (there is nothing to launch)', () => {
    const timing: TimingDisplay = { display: '—', state: 'no-steps' };
    expect(workspaceLaunchTimeLabel(timing)).toBe('—');
  });

  it('appends "to launch" for full', () => {
    const timing: TimingDisplay = { display: '~3s', state: 'full' };
    expect(workspaceLaunchTimeLabel(timing)).toBe('~3s to launch');
  });

  it('renders unmeasured as-is, with no suffix', () => {
    const timing: TimingDisplay = { display: 'Not yet measured', state: 'unmeasured' };
    expect(workspaceLaunchTimeLabel(timing)).toBe('Not yet measured');
  });

  it('renders partial as-is, with no suffix', () => {
    const timing: TimingDisplay = { display: '~8s · 2/3 steps timed', state: 'partial' };
    expect(workspaceLaunchTimeLabel(timing)).toBe('~8s · 2/3 steps timed');
  });
});

describe('workspaceLaunchTimeTooltip', () => {
  it('returns distinct, non-empty copy for every state', () => {
    const states: TimingDisplay['state'][] = ['no-steps', 'unmeasured', 'partial', 'full'];
    const tooltips = states.map((state) => workspaceLaunchTimeTooltip({ display: '', state }));
    expect(new Set(tooltips).size).toBe(states.length);
    tooltips.forEach((t) => expect(t.length).toBeGreaterThan(0));
  });

  it('never claims "restore" or "ready" framing', () => {
    const states: TimingDisplay['state'][] = ['no-steps', 'unmeasured', 'partial', 'full'];
    for (const state of states) {
      const tooltip = workspaceLaunchTimeTooltip({ display: '', state });
      expect(tooltip.toLowerCase()).not.toContain('ready');
    }
  });
});

describe('stepLaunchTimeTooltip', () => {
  it('explains the unmeasured state', () => {
    const timing: TimingDisplay = { display: 'Not yet measured', state: 'unmeasured' };
    expect(stepLaunchTimeTooltip(timing)).toContain('not measured yet');
  });

  it('shows the real value for a measured step', () => {
    const timing: TimingDisplay = { display: '~3s', state: 'full' };
    expect(stepLaunchTimeTooltip(timing)).toBe('Launch time: ~3s');
  });
});
