import React from 'react';
import { Button } from '@material-ui/core';
import { Brightness4, Brightness7 } from '@material-ui/icons';

const ThemeToggle = ({ theme, onToggle }) => (
  <Button
    className="theme-toggle"
    variant="outlined"
    startIcon={theme === 'dark' ? <Brightness7 /> : <Brightness4 />}
    onClick={onToggle}
    aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
  >
    {theme === 'dark' ? 'Light theme' : 'Dark theme'}
  </Button>
);

export default ThemeToggle;
