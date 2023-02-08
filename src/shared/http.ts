import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  CreateAxiosDefaults,
} from 'axios';

export class HttpError extends Error {
  public isHttpException = true;

  public name = 'HttpException';

  constructor(
    public message: string,
    public status: number,
    public response: unknown,
  ) {
    super(message);
  }

  static parse(error: AxiosError | Error) {
    if (error instanceof AxiosError) {
      return new HttpError(
        error?.response?.data?.message || error.message,
        error?.response?.status || 0,
        error?.response?.data,
      );
    }

    return error;
  }
}

export class Http {
  private $axios: AxiosInstance;

  constructor(config?: CreateAxiosDefaults<unknown>) {
    this.$axios = axios.create(config);
  }

  private getUrl(url: string) {
    return url;
  }

  static async request<T>(config: AxiosRequestConfig) {
    try {
      const { data, ...rest } = await axios(config);

      return { data: data as T, ...rest };
    } catch (error) {
      throw HttpError.parse(error as AxiosError);
    }
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const { data } = await this.$axios.get(this.getUrl(url), config);

      return data as T;
    } catch (error) {
      throw HttpError.parse(error as AxiosError);
    }
  }

  async put<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const { data } = await this.$axios.put(this.getUrl(url), body, config);

      return data as T;
    } catch (error) {
      throw HttpError.parse(error as AxiosError);
    }
  }

  async post<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const { data } = await this.$axios.post(this.getUrl(url), body, config);

      return data as T;
    } catch (error) {
      throw HttpError.parse(error as AxiosError);
    }
  }

  async delete<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const { data: d } = await this.$axios.delete(this.getUrl(url), {
        data,
        ...(config || {}),
      });

      return d as T;
    } catch (error) {
      throw HttpError.parse(error as AxiosError);
    }
  }
}
