export type RequestStatus = 'pending' | 'approved' | 'denied';
export type CodeStatus = 'active' | 'expired' | 'revoked';

export interface AccessRequest {
  id: string;
  name: string;
  cookieId: string;
  status: RequestStatus;
  createdAt: number; // ms epoch
}

export interface AccessCode {
  code: string; // 8-char uppercase
  requestId: string;
  name: string;
  timeoutMinutes: number;
  approvedAt: number; // ms epoch
  expiresAt: number; // ms epoch
  status: CodeStatus;
}
