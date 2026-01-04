// Path: znvault-cli/src/tui/App.tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Dashboard } from './screens/Dashboard.js';
import { useDashboard } from './hooks/useApi.js';

type Screen = 'dashboard' | 'secrets' | 'audit' | 'cluster' | 'help';

interface AppProps {
  initialScreen?: Screen;
  refreshInterval?: number;
}

function HelpOverlay({ onClose }: { onClose: () => void }): React.ReactElement {
  useInput((input) => {
    if (input === '?' || input === 'q' || input === '\x1b') {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      padding={2}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">KEYBOARD SHORTCUTS</Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Box>
          <Text color="cyan" bold>{'q'.padEnd(10)}</Text>
          <Text>Quit the dashboard</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'r'.padEnd(10)}</Text>
          <Text>Refresh data now</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'?'.padEnd(10)}</Text>
          <Text>Toggle this help</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'1'.padEnd(10)}</Text>
          <Text>Dashboard view</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'Esc'.padEnd(10)}</Text>
          <Text>Close overlay / Go back</Text>
        </Box>
      </Box>

      <Box marginTop={2} justifyContent="center">
        <Text color="gray">Press any key to close</Text>
      </Box>
    </Box>
  );
}

export function App({ initialScreen = 'dashboard', refreshInterval = 5000 }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [showHelp, setShowHelp] = useState(false);

  const dashboardData = useDashboard(refreshInterval);

  useInput((input, key) => {
    // Handle help overlay
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    // Global shortcuts
    if (input === 'q') {
      exit();
      return;
    }

    if (input === '?') {
      setShowHelp(true);
      return;
    }

    if (input === 'r') {
      void dashboardData.refresh();
      return;
    }

    // Screen navigation
    if (input === '1') {
      setScreen('dashboard');
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (screen !== 'dashboard') {
        setScreen('dashboard');
      }
    }
  });

  // Show help overlay
  if (showHelp) {
    return (
      <Box flexDirection="column">
        <HelpOverlay onClose={() => { setShowHelp(false); }} />
      </Box>
    );
  }

  // Render current screen
  switch (screen) {
    case 'dashboard':
      return (
        <Dashboard
          data={dashboardData}
          onRefresh={dashboardData.refresh}
        />
      );

    default:
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">Screen "{screen}" not implemented yet</Text>
          <Text color="gray">Press 1 to return to dashboard</Text>
        </Box>
      );
  }
}
