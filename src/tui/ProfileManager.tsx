// Path: znvault-cli/src/tui/ProfileManager.tsx
/**
 * Profile Manager TUI
 *
 * Interactive terminal UI for managing znvault profiles.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import TextInput from 'ink-text-input';
import {
  ProfileList,
  ProfileDetail,
  type ProfileItem,
} from './components/ProfileList.js';
import {
  listProfiles,
  switchProfile,
  createProfile,
  deleteProfile,
  getProfile,
  getActiveProfileName,
} from '../lib/config.js';

type Mode = 'list' | 'create' | 'delete-confirm' | 'help';

interface CreateFormState {
  step: 'name' | 'url';
  name: string;
  url: string;
}

function loadProfiles(): ProfileItem[] {
  const profiles = listProfiles();
  return profiles.map((p) => {
    const profile = getProfile(p.name);
    return {
      name: p.name,
      url: p.url,
      active: p.active,
      hasCredentials: p.hasCredentials,
      hasApiKey: p.hasApiKey,
      username: profile?.credentials?.username,
    };
  });
}

function Header(): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={0}
      marginBottom={1}
    >
      <Text bold color="cyan">ZN-Vault Profile Manager</Text>
    </Box>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }): React.ReactElement {
  useInput((input, key) => {
    if (input === '?' || input === 'q' || key.escape || key.return) {
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

      <Box flexDirection="column" gap={0}>
        <Box>
          <Text color="cyan" bold>{'↑/k'.padEnd(12)}</Text>
          <Text>Move up</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'↓/j'.padEnd(12)}</Text>
          <Text>Move down</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'Enter'.padEnd(12)}</Text>
          <Text>Switch to selected profile</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'c'.padEnd(12)}</Text>
          <Text>Create new profile</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'d'.padEnd(12)}</Text>
          <Text>Delete selected profile</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'?'.padEnd(12)}</Text>
          <Text>Show this help</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{'q/Esc'.padEnd(12)}</Text>
          <Text>Quit</Text>
        </Box>
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text color="gray">Press any key to close</Text>
      </Box>
    </Box>
  );
}

function CreateProfileForm({
  onComplete,
  onCancel,
}: {
  onComplete: (name: string, url: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [state, setState] = useState<CreateFormState>({
    step: 'name',
    name: '',
    url: 'https://localhost:8443',
  });
  const { isRawModeSupported } = useStdin();

  const handleNameSubmit = useCallback(() => {
    if (state.name.trim()) {
      setState((prev) => ({ ...prev, step: 'url' }));
    }
  }, [state.name]);

  const handleUrlSubmit = useCallback(() => {
    if (state.url.trim()) {
      onComplete(state.name.trim(), state.url.trim());
    }
  }, [state.name, state.url, onComplete]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  if (!isRawModeSupported) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Interactive input not supported in this terminal</Text>
        <Text color="gray">Use: znvault profile create {'<name>'} --vault-url {'<url>'}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      padding={2}
    >
      <Box marginBottom={1}>
        <Text bold color="green">Create New Profile</Text>
      </Box>

      {state.step === 'name' && (
        <Box>
          <Text color="gray">Profile name: </Text>
          <TextInput
            value={state.name}
            onChange={(value) => { setState((prev) => ({ ...prev, name: value })); }}
            onSubmit={handleNameSubmit}
            placeholder="my-profile"
          />
        </Box>
      )}

      {state.step === 'url' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="gray">Name: </Text>
            <Text color="cyan">{state.name}</Text>
          </Box>
          <Box>
            <Text color="gray">Vault URL: </Text>
            <TextInput
              value={state.url}
              onChange={(value) => { setState((prev) => ({ ...prev, url: value })); }}
              onSubmit={handleUrlSubmit}
              placeholder="https://vault.example.com"
            />
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">Press Enter to continue, Esc to cancel</Text>
      </Box>
    </Box>
  );
}

function DeleteConfirm({
  profileName,
  onConfirm,
  onCancel,
}: {
  profileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      padding={2}
    >
      <Box marginBottom={1}>
        <Text bold color="red">Delete Profile</Text>
      </Box>

      <Text>
        Are you sure you want to delete profile{' '}
        <Text color="cyan" bold>{profileName}</Text>?
      </Text>

      <Box marginTop={1}>
        <Text color="gray">Press </Text>
        <Text color="green" bold>y</Text>
        <Text color="gray"> to confirm, </Text>
        <Text color="red" bold>n</Text>
        <Text color="gray"> to cancel</Text>
      </Box>
    </Box>
  );
}

function Footer({ mode }: { mode: Mode }): React.ReactElement {
  if (mode !== 'list') {
    return <Box />;
  }

  return (
    <Box marginTop={1} paddingX={1}>
      <Text color="gray">
        [↑↓/jk] Navigate  [Enter] Switch  [c] Create  [d] Delete  [?] Help  [q] Quit
      </Text>
    </Box>
  );
}

interface StatusMessageProps {
  message: string | null;
  type: 'success' | 'error' | 'info';
}

function StatusMessage({ message, type }: StatusMessageProps): React.ReactElement | null {
  if (!message) return null;

  const colors = {
    success: 'green',
    error: 'red',
    info: 'blue',
  };

  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
  };

  return (
    <Box paddingX={1} marginTop={1}>
      <Text color={colors[type]}>{icons[type]} {message}</Text>
    </Box>
  );
}

export function ProfileManager(): React.ReactElement {
  const { exit } = useApp();
  const [profiles, setProfiles] = useState<ProfileItem[]>(loadProfiles);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const activeProfile = getActiveProfileName();
    const idx = loadProfiles().findIndex((p) => p.name === activeProfile);
    return idx >= 0 ? idx : 0;
  });
  const [mode, setMode] = useState<Mode>('list');
  const [statusMessage, setStatusMessage] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Clear status message after 3 seconds
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => {
        setStatusMessage(null);
      }, 3000);
      return () => { clearTimeout(timer); };
    }
  }, [statusMessage]);

  const refreshProfiles = useCallback(() => {
    setProfiles(loadProfiles());
  }, []);

  const handleSwitch = useCallback(() => {
    if (profiles.length === 0 || selectedIndex >= profiles.length) return;
    const profile = profiles[selectedIndex];

    if (profile.active) {
      setStatusMessage({ message: `Already using profile '${profile.name}'`, type: 'info' });
      return;
    }

    try {
      switchProfile(profile.name);
      refreshProfiles();
      setStatusMessage({ message: `Switched to profile '${profile.name}'`, type: 'success' });
    } catch (err) {
      setStatusMessage({ message: (err as Error).message, type: 'error' });
    }
  }, [profiles, selectedIndex, refreshProfiles]);

  const handleCreate = useCallback((name: string, url: string) => {
    try {
      createProfile(name, { url });
      refreshProfiles();
      setMode('list');
      setStatusMessage({ message: `Created profile '${name}'`, type: 'success' });
      // Select the new profile
      const newProfiles = loadProfiles();
      const newIndex = newProfiles.findIndex((p) => p.name === name);
      if (newIndex >= 0) {
        setSelectedIndex(newIndex);
      }
    } catch (err) {
      setStatusMessage({ message: (err as Error).message, type: 'error' });
      setMode('list');
    }
  }, [refreshProfiles]);

  const handleDelete = useCallback(() => {
    if (profiles.length === 0 || selectedIndex >= profiles.length) return;
    const profile = profiles[selectedIndex];

    try {
      deleteProfile(profile.name);
      refreshProfiles();
      setMode('list');
      setStatusMessage({ message: `Deleted profile '${profile.name}'`, type: 'success' });
      // Adjust selection if needed
      if (selectedIndex >= profiles.length - 1) {
        setSelectedIndex(Math.max(0, profiles.length - 2));
      }
    } catch (err) {
      setStatusMessage({ message: (err as Error).message, type: 'error' });
      setMode('list');
    }
  }, [profiles, selectedIndex, refreshProfiles]);

  useInput((input, key) => {
    // Don't handle input in create mode (TextInput handles it)
    if (mode === 'create') return;

    // Handle other modes
    if (mode === 'help') {
      setMode('list');
      return;
    }

    if (mode === 'delete-confirm') {
      // Handled by DeleteConfirm component
      return;
    }

    // List mode shortcuts
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    if (input === '?') {
      setMode('help');
      return;
    }

    if (input === 'j' || key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, profiles.length - 1));
      return;
    }

    if (input === 'k' || key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (key.return) {
      handleSwitch();
      return;
    }

    if (input === 'c') {
      setMode('create');
      return;
    }

    if (input === 'd') {
      if (profiles.length > 0 && selectedIndex < profiles.length) {
        const profile = profiles[selectedIndex];
        if (profile.name !== 'default') {
          setMode('delete-confirm');
        } else {
          setStatusMessage({ message: "Cannot delete the 'default' profile", type: 'error' });
        }
      }
    }
  });

  const selectedProfile = profiles[selectedIndex] ?? null;

  return (
    <Box flexDirection="column">
      <Header />

      {mode === 'help' && (
        <HelpOverlay onClose={() => { setMode('list'); }} />
      )}

      {mode === 'create' && (
        <CreateProfileForm
          onComplete={handleCreate}
          onCancel={() => { setMode('list'); }}
        />
      )}

      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- selectedProfile can be null */}
      {mode === 'delete-confirm' && selectedProfile && (
        <DeleteConfirm
          profileName={selectedProfile.name}
          onConfirm={handleDelete}
          onCancel={() => { setMode('list'); }}
        />
      )}

      {mode === 'list' && (
        <>
          <ProfileList
            profiles={profiles}
            selectedIndex={selectedIndex}
          />
          <ProfileDetail profile={selectedProfile} />
        </>
      )}

      <StatusMessage
        message={statusMessage?.message ?? null}
        type={statusMessage?.type ?? 'info'}
      />

      <Footer mode={mode} />
    </Box>
  );
}
