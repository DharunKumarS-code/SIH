import { useApi } from '../lib/useApi.js'
import { api } from '../lib/api.js'
import { dateShort } from '../lib/format.js'
import {
  PageHeader, PageScroll, Card, DataTable, Badge, Spinner, ErrorNote,
} from '../components/ui/primitives.jsx'

const PERMISSION_MATRIX = [
  ['Citizen', 'Search & view public parcel info, submit & track service requests'],
  ['Land Officer', 'Verify ownership, review land records, update verification, process requests'],
  ['Survey Officer', 'Review parcel boundaries, survey updates, run AI extraction / change review'],
  ['Planning Officer', 'Building approvals, land use, master plan'],
  ['Revenue Officer', 'Property tax view & update'],
  ['Administrator', 'Users, roles, system configuration, full audit log'],
]

export default function UsersRoles() {
  const users = useApi(() => api.users(), [])
  const audit = useApi(() => api.audit(), [])

  return (
    <PageScroll>
      <PageHeader title="Users & Roles" subtitle="Role-based access control and audit trail" />

      <Card className="mb-4" title="Role permission matrix">
        <DataTable
          rowKey={(r) => r[0]}
          columns={[
            { key: 'role', header: 'Role', render: (r) => <Badge>{r[0]}</Badge> },
            { key: 'perm', header: 'Permissions', render: (r) => <span className="text-slate-600">{r[1]}</span> },
          ]}
          rows={PERMISSION_MATRIX}
        />
      </Card>

      <Card className="mb-4" title="Accounts">
        {users.loading && <Spinner />}
        <ErrorNote error={users.error} onRetry={users.reload} />
        {users.data && (
          <DataTable
            rowKey={(r) => r.username}
            columns={[
              { key: 'name', header: 'Name', render: (r) => <span className="text-slate-900">{r.name}</span> },
              { key: 'username', header: 'Username' },
              { key: 'email', header: 'Email' },
              { key: 'role', header: 'Role', render: (r) => <Badge>{r.role}</Badge> },
            ]}
            rows={users.data}
          />
        )}
      </Card>

      <Card title="Audit trail">
        {audit.loading && <Spinner />}
        <ErrorNote error={audit.error} onRetry={audit.reload} />
        {audit.data && (
          <DataTable
            rowKey={(r) => r.logId}
            empty="No audit entries"
            columns={[
              { key: 'at', header: 'Time', render: (r) => dateShort(r.at) },
              { key: 'user', header: 'User' },
              { key: 'action', header: 'Action', render: (r) => <span className="font-mono text-xs text-cyan">{r.action}</span> },
              { key: 'entityType', header: 'Entity' },
              { key: 'entityId', header: 'Entity ID', render: (r) => <span className="font-mono text-[11px]">{r.entityId}</span> },
            ]}
            rows={audit.data}
          />
        )}
      </Card>
    </PageScroll>
  )
}
