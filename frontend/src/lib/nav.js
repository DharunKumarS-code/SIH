import {
  LayoutDashboard,
  Map,
  Search,
  Building2,
  Layers,
  ScrollText,
  FileSignature,
  Stamp,
  Receipt,
  Gavel,
  BarChart3,
  Sparkles,
  ScanLine,
  Grid3x3,
  Mountain,
  Satellite,
  Network,
  Waypoints,
  Boxes,
  ClipboardList,
  FileText,
  Users,
  Settings,
  Landmark,
} from 'lucide-react'

// Grouped main navigation (government-portal layout, Phase 10).
// `perm` gates visibility against the current user's permissions; `role`
// restricts to one role. Items with neither are always shown. Every route is
// an existing App route — nothing is duplicated.
export const NAV_GROUPS = [
  {
    group: 'Land',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/parcels', label: 'Land Parcels', icon: Layers },
      { to: '/ulpin-search', label: 'ULPIN Search', icon: Search },
      { to: '/land-records', label: 'Land Records', icon: ScrollText, perm: 'ror:view' },
      { to: '/registration', label: 'Registration', icon: FileSignature, perm: 'registration:view' },
      { to: '/permissions', label: 'Building Permissions', icon: Stamp, perm: 'building-approval:view' },
      { to: '/tax', label: 'Property Tax', icon: Receipt, perm: 'tax:view' },
      { to: '/disputes', label: 'Disputes', icon: Gavel, perm: 'dispute:view' },
    ],
  },
  {
    group: '3D Cadastre',
    items: [
      { to: '/map', label: '3D Map', icon: Map },
      { to: '/buildings', label: 'Buildings', icon: Building2 },
      { to: '/explorer', label: 'Floors & Units', icon: Layers },
      { to: '/identifier', label: '3D Property Identifier', icon: Boxes, perm: '3didentifier:read' },
    ],
  },
  {
    group: 'Data & AI',
    items: [
      { to: '/ai', label: 'AI Studio', icon: Sparkles, perm: 'ai:run' },
      { to: '/ai-buildings', label: 'Building Extraction', icon: ScanLine, perm: 'ai:run' },
      { to: '/ai-floorplans', label: 'Floor Plan Segmentation', icon: Grid3x3, perm: 'ai:run' },
      { to: '/elevation', label: 'Elevation / LiDAR', icon: Mountain, perm: 'ai:run' },
      { to: '/gnss', label: 'GNSS / CORS Control', icon: Satellite, perm: 'ai:run' },
    ],
  },
  {
    group: 'Validation',
    items: [
      { to: '/topology', label: 'Topology Validation', icon: Network, perm: 'topology:read' },
    ],
  },
  {
    group: 'Infrastructure',
    items: [
      { to: '/underground', label: 'Underground Infrastructure', icon: Waypoints, perm: 'infrastructure:read' },
      { to: '/tngis', label: 'TNGIS / Tamil Nilam', icon: Landmark },
    ],
  },
  {
    group: 'Governance',
    items: [
      { to: '/governance', label: 'Governance', icon: Landmark },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileText, perm: 'report:view' },
      { to: '/services', label: 'Services', icon: ClipboardList },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/users', label: 'Users & Roles', icon: Users, role: 'Administrator' },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

// Flat list kept for any legacy import.
export const NAV = NAV_GROUPS.flatMap((g) => g.items)
