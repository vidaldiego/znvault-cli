// Path: znvault-cli/src/tui/components/UpdateBanner.tsx
import React from 'react';
import { Box, Text } from 'ink';

interface UpdateBannerProps {
  currentVersion: string;
  latestVersion: string;
  packageName?: string;
}

export function UpdateBanner({
  currentVersion,
  latestVersion,
  packageName = '@zincapp/znvault-cli',
}: UpdateBannerProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">✨ Update available!</Text>
      </Box>

      <Box gap={2}>
        <Box flexDirection="column">
          <Text color="gray">Current:</Text>
          <Text color="gray">Latest:</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="red">{currentVersion}</Text>
          <Text color="green" bold>{latestVersion}</Text>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">Run one of:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            <Text color="cyan">znvault self-update</Text>
          </Text>
          <Text>
            <Text color="cyan">npm update -g {packageName}</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
