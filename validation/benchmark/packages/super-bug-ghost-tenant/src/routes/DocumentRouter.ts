import { TenantMiddleware, TenantRequest } from '../middleware/TenantMiddleware';
import { AuthMiddleware } from '../middleware/AuthMiddleware';
import { DocumentService } from '../services/DocumentService';
import { getTenant } from '../context/TenantContext';

export interface RouterResponse {
  status: number;
  body: unknown;
  requestTenant?: string;
}

let _requestCounter = 0;

export class DocumentRouter {
  private tenantMiddleware: TenantMiddleware;
  private authMiddleware: AuthMiddleware;
  private service: DocumentService;

  constructor(
    tenantMiddleware: TenantMiddleware,
    authMiddleware: AuthMiddleware,
    service: DocumentService
  ) {
    this.tenantMiddleware = tenantMiddleware;
    this.authMiddleware = authMiddleware;
    this.service = service;
  }

  async handleList(
    headers: Record<string, string>,
    rawTenantId: string
  ): Promise<RouterResponse> {
    const requestId = `req_${++_requestCounter}`;

    let enrichedReq: TenantRequest;
    try {
      const baseReq: TenantRequest = {
        tenantId: rawTenantId,
        userId: '',
        path: '/documents',
        method: 'GET',
        headers,
      };
      enrichedReq = this.authMiddleware.enrichRequest(baseReq, headers['authorization']);
    } catch (err) {
      return {
        status: 401,
        body: { error: err instanceof Error ? err.message : 'Unauthorized' },
      };
    }

    let result: RouterResponse = { status: 500, body: { error: 'Internal error' } };

    await this.tenantMiddleware.handle(enrichedReq, async () => {
      const activeTenant = getTenant();
      const listResult = await this.service.listDocuments(
        enrichedReq.userId,
        requestId
      );
      result = {
        status: 200,
        body: listResult,
        requestTenant: activeTenant,
      };
    });

    return result;
  }

  async handleGet(
    headers: Record<string, string>,
    rawTenantId: string,
    documentId: string
  ): Promise<RouterResponse> {
    const requestId = `req_${++_requestCounter}`;

    let enrichedReq: TenantRequest;
    try {
      const baseReq: TenantRequest = {
        tenantId: rawTenantId,
        userId: '',
        path: `/documents/${documentId}`,
        method: 'GET',
        headers,
      };
      enrichedReq = this.authMiddleware.enrichRequest(baseReq, headers['authorization']);
    } catch (err) {
      return {
        status: 401,
        body: { error: err instanceof Error ? err.message : 'Unauthorized' },
      };
    }

    let result: RouterResponse = { status: 500, body: { error: 'Internal error' } };

    await this.tenantMiddleware.handle(enrichedReq, async () => {
      const docResult = await this.service.getDocument(
        documentId,
        enrichedReq.userId,
        requestId
      );
      result = {
        status: docResult.found ? 200 : 404,
        body: docResult.found
          ? { document: docResult.document }
          : { error: 'Document not found' },
        requestTenant: getTenant(),
      };
    });

    return result;
  }
}
