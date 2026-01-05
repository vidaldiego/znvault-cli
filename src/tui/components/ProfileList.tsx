// Path: znvault-cli/src/tui/components/ProfileList.tsx
/**
 * Interactive Profile List Component
 *
 * Renders a navigable list of profiles with keyboard controls.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface ProfileItem {
  name: string;
  url: string;
  active: boolean;
  hasCredentials: boolean;
  hasApiKey: boolean;
  username?: string;
}

export interface ProfileListProps {
  profiles: ProfileItem[];
  selectedIndex: number;
  onSelect?: (profile: ProfileItem) => void;
}

function getAuthBadge(profile: ProfileItem): React.ReactElement | null {
  if (profile.hasApiKey) {
    return <Text color="magenta"> [API key]</Text>;
  }
  if (profile.hasCredentials) {
    return <Text color="blue"> [JWT]</Text>;
  }
  return <Text color="gray"> [no auth]</Text>;
}

export function ProfileList({
  profiles,
  selectedIndex,
}: ProfileListProps): React.ReactElement {
  if (profiles.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">No profiles configured</Text>
        <Text color="gray">Press 'c' to create a new profile</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {profiles.map((profile, index) => {
        const isSelected = index === selectedIndex;
        const isActive = profile.active;

        return (
          <Box key={profile.name} paddingX={1}>
            {/* Selection indicator */}
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '>' : ' '}
            </Text>

            {/* Active indicator */}
            <Text color="green">
              {isActive ? ' *' : '  '}
            </Text>

            {/* Profile name */}
            <Box width={20}>
              <Text
                color={isSelected ? 'cyan' : isActive ? 'green' : undefined}
                bold={isSelected || isActive}
              >
                {' '}{profile.name}
              </Text>
            </Box>

            {/* Auth badge */}
            <Box width={12}>
              {getAuthBadge(profile)}
            </Box>

            {/* URL */}
            <Text color="gray"> {profile.url}</Text>

            {/* Username if logged in */}
            {profile.username && (
              <Text color="gray"> ({profile.username})</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export interface ProfileDetailProps {
  profile: ProfileItem | null;
}

export function ProfileDetail({ profile }: ProfileDetailProps): React.ReactElement {
  if (!profile) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        marginTop={1}
      >
        <Text color="gray">Select a profile to view details</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={profile.active ? 'green' : 'gray'}
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="white">
          {profile.name}
          {profile.active && <Text color="green"> (active)</Text>}
        </Text>
      </Box>

      <Box>
        <Box width={12}>
          <Text color="gray">URL:</Text>
        </Box>
        <Text>{profile.url}</Text>
      </Box>

      <Box>
        <Box width={12}>
          <Text color="gray">Auth:</Text>
        </Box>
        <Text color={profile.hasApiKey ? 'magenta' : profile.hasCredentials ? 'blue' : 'yellow'}>
          {profile.hasApiKey ? 'API Key' : profile.hasCredentials ? 'JWT' : 'Not authenticated'}
        </Text>
      </Box>

      {profile.username && (
        <Box>
          <Box width={12}>
            <Text color="gray">User:</Text>
          </Box>
          <Text>{profile.username}</Text>
        </Box>
      )}
    </Box>
  );
}
