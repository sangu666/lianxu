/** 可公开给客户端的业务错误；数据库异常继续由通用处理器隐藏细节。 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
