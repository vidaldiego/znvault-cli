// Path: znvault-cli/src/tui/components/Header.tsx
import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  title?: string;
  version?: string;
  lastUpdated?: Date | null;
}

export function Header({ title = 'ZN-VAULT', version, lastUpdated }: HeaderProps): React.ReactElement {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString()
    : '--:--:--';

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      justifyContent="space-between"
      marginBottom={1}
    >
      <Box>
        <Text bold color="cyan">{title}</Text>
        {version && (
          <Text color="gray"> v{version}</Text>
        )}
      </Box>
      <Box>
        <Text color="gray">Updated: {timeStr}</Text>
        <Text color="gray" dimColor> │ </Text>
        <Text color="yellow">[q]</Text>
        <Text color="gray">uit </Text>
        <Text color="yellow">[r]</Text>
        <Text color="gray">efresh </Text>
        <Text color="yellow">[?]</Text>
        <Text color="gray">help</Text>
      </Box>
    </Box>
  );
}
