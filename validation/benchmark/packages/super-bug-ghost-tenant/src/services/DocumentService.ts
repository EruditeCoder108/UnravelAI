import { DocumentRepository, Document, DocumentFilter } from '../repositories/DocumentRepository';
import { AuditLogger } from '../audit/AuditLogger';

export interface ListResult {
  documents: Document[];
  total: number;
  requestedByTenant: string;
}

export interface DocumentResult {
  document: Document | null;
  found: boolean;
}

export class DocumentService {
  private repo: DocumentRepository;
  private audit: AuditLogger;

  constructor(repo: DocumentRepository, audit: AuditLogger) {
    this.repo = repo;
    this.audit = audit;
  }

  async listDocuments(
    userId: string,
    requestId: string,
    filter?: DocumentFilter
  ): Promise<ListResult> {
    const documents = await this.repo.findAll(filter);

    this.audit.record(userId, 'document.list', requestId, undefined, {
      filter,
      resultCount: documents.length,
    });

    const tenantId = documents.length > 0 ? documents[0].tenant_id : 'unknown';

    return {
      documents,
      total: documents.length,
      requestedByTenant: tenantId,
    };
  }

  async getDocument(
    id: string,
    userId: string,
    requestId: string
  ): Promise<DocumentResult> {
    const document = await this.repo.findById(id);

    if (document) {
      this.audit.record(userId, 'document.read', requestId, id);
    }

    return { document, found: !!document };
  }

  async createDocument(
    data: Parameters<DocumentRepository['create']>[0],
    userId: string,
    requestId: string
  ): Promise<Document> {
    const document = await this.repo.create(data);
    this.audit.record(userId, 'document.create', requestId, document.id);
    return document;
  }
}
