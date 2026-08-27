/**
 * Public surface of the shared `@app/common` library. Feature modules import
 * from here rather than reaching into individual files.
 */
export * from './entities/base.entity';
export * from './dto/pagination-query.dto';
export * from './dto/paginated-result.dto';
export * from './interceptors/transform.interceptor';
export * from './interceptors/transaction.interceptor';
export * from './filters/http-exception.filter';
export * from './decorators/api-paginated-response.decorator';
export * from './decorators/transactional.decorator';
export * from './decorators/transaction-manager.decorator';
