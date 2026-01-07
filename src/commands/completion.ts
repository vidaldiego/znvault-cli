// Path: znvault-cli/src/commands/completion.ts

import { type Command } from 'commander';
import * as output from '../lib/output.js';

/**
 * Generate Bash completion script
 */
function generateBashCompletion(): string {
  return `# znvault bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(znvault completion bash)"

_znvault_completions() {
    local cur prev words cword
    _init_completion || return

    # Top-level commands
    local commands="login logout whoami config profile health status cluster tenant user superadmin lockdown audit emergency cert agent update apikey policy permissions secret kms role backup notification tui dashboard self-update advisor completion version help"

    # Subcommands for each command group
    local cluster_cmds="status takeover release promote maintenance"
    local tenant_cmds="list get create update delete usage"
    local user_cmds="list get create update delete unlock reset-password disable-totp"
    local superadmin_cmds="list create reset-password unlock disable enable"
    local lockdown_cmds="status trigger clear history threats"
    local audit_cmds="list verify export"
    local agent_cmds="list get register-token revoke-token"
    local update_cmds="list get create upload set-latest"
    local apikey_cmds="list get create delete rotate permissions conditions enable disable policies attach-policy detach-policy self managed"
    local policy_cmds="list get create update delete toggle validate attachments attach-user attach-role detach-user detach-role test"
    local secret_cmds="list get create update delete copy"
    local kms_cmds="key encrypt decrypt sign verify"
    local role_cmds="list get create update delete users assign unassign"
    local backup_cmds="config list create restore delete"
    local notification_cmds="config test"
    local advisor_cmds="audit rules suggest llm"
    local advisor_llm_cmds="status get config test delete"
    local profile_cmds="list create delete use rename"
    local completion_cmds="bash zsh"

    case "\${cword}" in
        1)
            COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
            ;;
        2)
            case "\${prev}" in
                cluster) COMPREPLY=( \$(compgen -W "\${cluster_cmds}" -- "\${cur}") ) ;;
                tenant) COMPREPLY=( \$(compgen -W "\${tenant_cmds}" -- "\${cur}") ) ;;
                user) COMPREPLY=( \$(compgen -W "\${user_cmds}" -- "\${cur}") ) ;;
                superadmin) COMPREPLY=( \$(compgen -W "\${superadmin_cmds}" -- "\${cur}") ) ;;
                lockdown) COMPREPLY=( \$(compgen -W "\${lockdown_cmds}" -- "\${cur}") ) ;;
                audit) COMPREPLY=( \$(compgen -W "\${audit_cmds}" -- "\${cur}") ) ;;
                agent) COMPREPLY=( \$(compgen -W "\${agent_cmds}" -- "\${cur}") ) ;;
                update) COMPREPLY=( \$(compgen -W "\${update_cmds}" -- "\${cur}") ) ;;
                apikey|api-key) COMPREPLY=( \$(compgen -W "\${apikey_cmds}" -- "\${cur}") ) ;;
                policy) COMPREPLY=( \$(compgen -W "\${policy_cmds}" -- "\${cur}") ) ;;
                secret) COMPREPLY=( \$(compgen -W "\${secret_cmds}" -- "\${cur}") ) ;;
                kms) COMPREPLY=( \$(compgen -W "\${kms_cmds}" -- "\${cur}") ) ;;
                role) COMPREPLY=( \$(compgen -W "\${role_cmds}" -- "\${cur}") ) ;;
                backup) COMPREPLY=( \$(compgen -W "\${backup_cmds}" -- "\${cur}") ) ;;
                notification) COMPREPLY=( \$(compgen -W "\${notification_cmds}" -- "\${cur}") ) ;;
                advisor) COMPREPLY=( \$(compgen -W "\${advisor_cmds}" -- "\${cur}") ) ;;
                profile) COMPREPLY=( \$(compgen -W "\${profile_cmds}" -- "\${cur}") ) ;;
                completion) COMPREPLY=( \$(compgen -W "\${completion_cmds}" -- "\${cur}") ) ;;
                *) ;;
            esac
            ;;
        3)
            # Handle nested subcommands (e.g., advisor llm)
            if [[ "\${words[1]}" == "advisor" && "\${prev}" == "llm" ]]; then
                COMPREPLY=( \$(compgen -W "\${advisor_llm_cmds}" -- "\${cur}") )
            fi
            ;;
        *)
            # Complete options based on current command
            local opts=""
            case "\${words[1]}" in
                login) opts="--username -u --password -p --totp" ;;
                health) opts="--json --leader" ;;
                status) opts="--json" ;;
                secret)
                    case "\${words[2]}" in
                        list) opts="--tenant -t --type --tag --json" ;;
                        get) opts="--tenant -t --json --decrypt" ;;
                        create) opts="--tenant -t --type --tags --expires --file --suggest --json" ;;
                        *) ;;
                    esac
                    ;;
                advisor)
                    case "\${words[2]}" in
                        audit) opts="--tenant --category --severity --ai-summary --json" ;;
                        suggest) opts="--tenant --environment --service --team --json" ;;
                        llm)
                            case "\${words[3]}" in
                                config) opts="--provider --api-key --model --max-tokens --enabled" ;;
                                status|get) opts="--json" ;;
                                *) ;;
                            esac
                            ;;
                        *) ;;
                    esac
                    ;;
                *) ;;
            esac
            # Add global options
            opts="\${opts} --url --insecure --profile --plain --help -h"
            COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
            ;;
    esac
}

complete -F _znvault_completions znvault
`;
}

/**
 * Generate Zsh completion script
 */
function generateZshCompletion(): string {
  return `#compdef znvault
# znvault zsh completion
# Add to ~/.zshrc:
#   eval "$(znvault completion zsh)"

_znvault() {
    local -a commands subcommands opts
    local curcontext="\$curcontext" state line

    _arguments -C \\
        '--url[Vault server URL]:url:_urls' \\
        '--insecure[Skip TLS certificate verification]' \\
        '--profile[Use a specific configuration profile]:profile:->profiles' \\
        '--plain[Use plain text output]' \\
        '(-h --help)'{-h,--help}'[Show help]' \\
        '(-V --version)'{-V,--version}'[Show version]' \\
        '1: :->command' \\
        '*:: :->args'

    case \$state in
        profiles)
            local -a profiles
            profiles=(\${(f)"\$(znvault profile list --plain 2>/dev/null | awk '{print \$1}')"})
            _describe -t profiles 'profile' profiles
            ;;
        command)
            commands=(
                'login:Authenticate with the vault server'
                'logout:Clear stored credentials'
                'whoami:Show current authenticated user'
                'config:Manage CLI configuration'
                'profile:Manage configuration profiles'
                'health:Check vault server health'
                'status:Show comprehensive system status'
                'cluster:Cluster management commands'
                'tenant:Tenant management commands'
                'user:User management commands'
                'superadmin:Superadmin management commands'
                'lockdown:Lockdown and breach detection commands'
                'audit:Audit log commands'
                'emergency:Emergency operations'
                'cert:Certificate management'
                'agent:Manage remote agents'
                'update:Manage agent updates'
                'apikey:API key management'
                'policy:ABAC policy management'
                'permissions:Manage and view permissions'
                'secret:Manage secrets'
                'kms:KMS operations'
                'role:RBAC role management'
                'backup:Backup management'
                'notification:Email notification configuration'
                'tui:Launch interactive terminal dashboard'
                'dashboard:Launch interactive dashboard'
                'self-update:Update znvault CLI'
                'advisor:AI-powered security advisor'
                'completion:Generate shell completion scripts'
                'version:Show version'
                'help:Display help'
            )
            _describe -t commands 'command' commands
            ;;
        args)
            case \$words[1] in
                cluster)
                    subcommands=(
                        'status:Show cluster status'
                        'takeover:Force leadership takeover'
                        'release:Release leadership'
                        'promote:Promote a node'
                        'maintenance:Toggle maintenance mode'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                tenant)
                    subcommands=(
                        'list:List all tenants'
                        'get:Get tenant details'
                        'create:Create a new tenant'
                        'update:Update a tenant'
                        'delete:Delete a tenant'
                        'usage:Show tenant usage'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                user)
                    subcommands=(
                        'list:List users'
                        'get:Get user details'
                        'create:Create a user'
                        'update:Update a user'
                        'delete:Delete a user'
                        'unlock:Unlock a user'
                        'reset-password:Reset user password'
                        'disable-totp:Disable 2FA for user'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                secret)
                    subcommands=(
                        'list:List secrets'
                        'get:Get a secret'
                        'create:Create a secret'
                        'update:Update a secret'
                        'delete:Delete a secret'
                        'copy:Copy a secret'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                advisor)
                    subcommands=(
                        'audit:Run a security audit'
                        'rules:List security rules'
                        'suggest:Get AI suggestions'
                        'llm:Manage LLM configuration'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                profile)
                    subcommands=(
                        'list:List all profiles'
                        'create:Create a new profile'
                        'delete:Delete a profile'
                        'use:Switch active profile'
                        'rename:Rename a profile'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                kms)
                    subcommands=(
                        'key:Key management'
                        'encrypt:Encrypt data'
                        'decrypt:Decrypt data'
                        'sign:Sign data'
                        'verify:Verify signature'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                backup)
                    subcommands=(
                        'config:Configure backups'
                        'list:List backups'
                        'create:Create a backup'
                        'restore:Restore from backup'
                        'delete:Delete a backup'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                apikey|api-key)
                    subcommands=(
                        'list:List API keys'
                        'get:Get API key details'
                        'create:Create an API key'
                        'delete:Delete an API key'
                        'rotate:Rotate an API key'
                        'permissions:Update permissions'
                        'enable:Enable an API key'
                        'disable:Disable an API key'
                        'self:View current API key'
                        'managed:Managed API keys'
                    )
                    _describe -t subcommands 'subcommand' subcommands
                    ;;
                completion)
                    subcommands=(
                        'bash:Generate bash completion'
                        'zsh:Generate zsh completion'
                    )
                    _describe -t subcommands 'shell' subcommands
                    ;;
                *)
                    _files
                    ;;
            esac
            ;;
    esac
}

_znvault "\$@"
`;
}

export function registerCompletionCommands(program: Command): void {
  const completion = program
    .command('completion')
    .description('Generate shell completion scripts');

  completion
    .command('bash')
    .description('Generate bash completion script')
    .action(() => {
      console.log(generateBashCompletion());
    });

  completion
    .command('zsh')
    .description('Generate zsh completion script')
    .action(() => {
      console.log(generateZshCompletion());
    });

  // Default action shows installation instructions
  completion.action(() => {
    output.section('Shell Completion Setup');
    console.log('');
    output.info('Bash (add to ~/.bashrc):');
    console.log('  eval "$(znvault completion bash)"');
    console.log('');
    output.info('Zsh (add to ~/.zshrc):');
    console.log('  eval "$(znvault completion zsh)"');
    console.log('');
    output.info('Or save to a file:');
    console.log('  znvault completion bash > /etc/bash_completion.d/znvault');
    console.log('  znvault completion zsh > /usr/local/share/zsh/site-functions/_znvault');
  });
}
