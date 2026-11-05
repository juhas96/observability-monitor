import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  Field,
  FieldSet,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Text,
  Status,
  toast,
} from "@glaze/core/components";

import { monitorApi } from "../ipc";
import { useAccountMutations, useGroups } from "../hooks/use-accounts";
import { useProviders } from "../hooks/use-providers";
import type { Account, CredentialField, Provider } from "../types";

const NO_GROUP = "__no_group__";
const NEW_GROUP = "__new_group__";

export function AddAccountDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Account | null;
}) {
  const { add, update } = useAccountMutations();
  const providersQuery = useProviders();
  const groupsQuery = useGroups();
  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  const [provider, setProvider] = useState<Provider>("github");
  const [label, setLabel] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [groupSelection, setGroupSelection] = useState(NO_GROUP);
  const [newGroupName, setNewGroupName] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isEditing = editing !== null;
  const definition = providers.find((p) => p.id === provider);
  const fields: CredentialField[] = definition?.fields ?? [];

  // Reset the form whenever the dialog opens or the editing target changes.
  useEffect(() => {
    if (!open) return;
    const initialProvider = editing?.provider ?? providers[0]?.id ?? "github";
    const initialGroup = editing?.groupId && groups.some((group) => group.id === editing.groupId) ? editing.groupId : NO_GROUP;
    setProvider(initialProvider);
    setLabel(editing?.label ?? "");
    setCreds({ ...(editing?.config ?? {}) }); // non-secret fields prefill; secrets stay blank
    setGroupSelection(initialGroup);
    setNewGroupName("");
    setTestResult(null);
    setTesting(false);
  }, [open, editing, groups, providers]);

  const setCred = (key: string, value: string) => setCreds((prev) => ({ ...prev, [key]: value }));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await monitorApi.testConnection({ provider, creds });
      if (res.ok) {
        setTestResult({ ok: true, message: res.identity ? `Connected: ${res.identity}` : "Connection OK" });
      } else {
        setTestResult({ ok: false, message: res.error ?? "Connection failed" });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleConfirm = async () => {
    // Drop empty values so blank secret fields on edit keep the existing token.
    const trimmed: Record<string, string> = {};
    for (const [k, v] of Object.entries(creds)) if (v.trim() !== "") trimmed[k] = v.trim();
    const groupPayload = groupSelection === NEW_GROUP
      ? { newGroupName: newGroupName.trim() }
      : { groupId: groupSelection === NO_GROUP ? null : groupSelection };

    if (isEditing) {
      await update.mutateAsync({ id: editing.id, label: label.trim() || undefined, creds: trimmed, ...groupPayload });
      toast.success("Account updated");
    } else {
      await add.mutateAsync({ provider, label: label.trim(), creds: trimmed, ...groupPayload });
      toast.success("Account added");
    }
    onOpenChange(false);
  };

  const hasValue = (key: string) => (creds[key] ?? "").trim().length > 0;
  const missingRequired = fields.some((f) => {
    if (!f.required) return false;
    // On edit, a required secret can stay blank to keep the stored value.
    if (isEditing && f.secret) return false;
    return !hasValue(f.key);
  });
  const canSubmit = label.trim().length > 0 && !missingRequired;
  const hasGroup = groupSelection !== NEW_GROUP || newGroupName.trim().length > 0;
  const canTest = fields.filter((f) => f.required && f.secret).every((f) => hasValue(f.key) || isEditing) &&
    fields.filter((f) => f.required && !f.secret).every((f) => hasValue(f.key));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit account" : "Add account"}
      description={
        isEditing ? "Update the label, credentials, or settings." : "Connect a service with an API token or key."
      }
      confirmLabel={isEditing ? "Save" : "Add account"}
      confirmDisabled={!canSubmit || !hasGroup}
      onConfirm={handleConfirm}
      size="medium"
    >
      <div className="flex flex-col gap-4">
        <FieldSet>
          <Field label="Provider" orientation="vertical" className="p-0">
            <Select value={provider} onValueChange={(v) => setProvider(v as Provider)} disabled={isEditing}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Label" orientation="vertical" className="p-0">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. ${definition?.label ?? ""} account`} />
          </Field>

          <Field label="Project group" orientation="vertical" className="p-0">
            <Select value={groupSelection} onValueChange={setGroupSelection}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>No group</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_GROUP}>Create new group</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {groupSelection === NEW_GROUP ? (
            <Field label="New group name" orientation="vertical" className="p-0">
              <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="e.g. Production app" />
            </Field>
          ) : null}

          {fields.map((field) => (
            <Field key={field.key} label={field.label} orientation="vertical" className="p-0">
              <Input
                type={field.type === "password" ? "password" : "text"}
                value={creds[field.key] ?? ""}
                onChange={(e) => setCred(field.key, e.target.value)}
                placeholder={isEditing && field.secret ? "Leave blank to keep current value" : field.placeholder}
              />
            </Field>
          ))}
        </FieldSet>

        {definition?.scopeHint ? (
          <Text variant="small" color="tertiary">
            {definition.scopeHint}
          </Text>
        ) : null}

        <div className="flex items-center gap-3">
          <Button variant="filled" size="small" onClick={handleTest} disabled={testing || !canTest}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testResult ? <Status variant={testResult.ok ? "success" : "error"}>{testResult.message}</Status> : null}
        </div>
      </div>
    </Dialog>
  );
}
