import { Server, ServerWebSocket, serve } from "bun";
import { createFetcher } from "fetcher";
import { handleError } from "./error-handler-validation";
import { SchemaType, TypeMapping } from "./types";

export type RouteHandler = (req: Request) => Response;

export type ServerRoute = {
  path: string;
  method: string;
  handler: RouteHandler;
};

export type ServerRouter = {
  addRoute: (path: string, method: string, handler: RouteHandler) => void;
  handleRequest: (req: Request) => Response;
};

export function createRouter(routeConfigs?: ServerRoute[]): ServerRouter {
  const routes: ServerRoute[] = [...(routeConfigs || [])];

  function addRoute(path: string, method: string, handler: RouteHandler) {
    routes.push({ path, method, handler });
  }

  function handleRequest(req: Request) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    for (const { path, method: routeMethod, handler } of routes) {
      if (url.pathname === path && method === routeMethod) {
        return handler(req);
      }
    }

    return new Response("Not found", { status: 404 });
  }

  return {
    addRoute,
    handleRequest,
  };
}

// crud-server.ts

export type CrudServer<Schema extends SchemaType> = {
  start: () => Server;
  stop: () => void;
  router: ServerRouter;
};

// TODO: Add encryption keys
export function createCrudServer<
  Schema extends Record<string, keyof TypeMapping>
>({
  router,
  port = 4000,
}: {
  router?: ServerRouter;
  port?: number;
}): CrudServer<Schema> {
  const server = serve({
    port: port ? `:${port}` : ":4000",
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // Check for frontend identifier
      // const identifier = req.headers.get("x-identifier");
      // if (!identifier) {
      //   return new Response("Not authorized", { status: 401 });
      // }
      console.log(req);

      try {
        if (url.pathname.startsWith("/api")) {
          // API routes
          const path = url.pathname.slice(4); // Remove "/api" prefix
          switch (req.method) {
            case "POST":
              if (path === "/create") {
                const item = await req.json();
                return new Response("Created", { status: 201 });
              }
              break;

            case "GET":
              if (path === "/read") {
                const items = [];
                return new Response(JSON.stringify(items));
              }
              break;

            case "PUT":
              if (path === "/update") {
                const id = Number(url.searchParams.get("id"));
                const item = {};
                return new Response("Updated", { status: 200 });
              }
              break;

            case "DELETE":
              if (path === "/delete") {
                const id = Number(url.searchParams.get("id"));

                return new Response("Deleted", { status: 200 });
              }
              break;

            default:
              return new Response("Not found", { status: 404 });
          }
        } else {
          // Router for frontend pages
          const handler = router && router[url.pathname];
          if (handler) {
            const response = await handler(req);
            return response;
          }
        }
      } catch (error) {
        const handledError = handleError(error);
        if (handledError) {
          return new Response(handledError.message, { status: 400 });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    start: () => {
      console.log(`Server started on port ${port}`);
      return server;
    },
    stop: () => server.stop(),
    router: router || {}, // Add this line
  };
}

export const useWebSockets = () => {
  return {
    open(ws: ServerWebSocket) {
      console.log("WebSocket connection opened");
    },
    message(ws: ServerWebSocket, message: unknown) {
      console.log("WebSocket message received:", message);

      // You can also send a response back to the connected client
      ws.send(`Server received: ${message}`);
    },
    close(ws: ServerWebSocket) {
      console.log("WebSocket connection closed");
      // You can add any cleanup code or resource release here.
    },
    error(ws: ServerWebSocket, error: Error) {
      console.error("WebSocket error:", error);
      // You can add any additional error handling or logging here.
    },
    drain(ws: ServerWebSocket) {
      console.log("WebSocket backpressure drained, ready for more data");
      // You can add any code to handle backpressure or resume sending data here.
    },
  };
};

type CompletionChoice = {
  message: {
    role: string;
    content: string;
  };
  index: number;
  finish_reason: string;
};

export type CompletionsResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: CompletionChoice[];
};

type BaseOpenAICompletionsParams = {
  numCompletions?: number;
  maxTokens?: number;
  apiKey?: string;
  // ID of the model to use
  model?: string;
  // The prompt(s) to generate completions for
  prompt?: string | string[] | number[] | number[][];

  // The suffix that comes after a completion of inserted text
  suffix?: string;

  // The maximum number of tokens to generate in the completion
  //2048 default newest models support 4096
  max_tokens?: number;

  // The sampling temperature to use, between 0 and 2
  temperature?: number;

  // The alternative to sampling with temperature, nucleus sampling
  top_p?: number;

  // How many completions to generate for each prompt
  n?: number;

  // Whether to stream back partial progress
  stream?: boolean;

  // Include the log probabilities on the most likely tokens
  logprobs?: number;

  // Echo back the prompt in addition to the completion
  echo?: boolean;

  // Up to 4 sequences where the API will stop generating further tokens
  stop?: string | string[];

  // Penalize new tokens based on whether they appear in the text so far
  presence_penalty?: number;

  // Penalize new tokens based on their existing frequency in the text so far
  frequency_penalty?: number;

  // Generates completions server-side and returns the "best" completion
  best_of?: number;

  // Modify the likelihood of specified tokens appearing in the completion
  logit_bias?: Record<number, number>;

  // A unique identifier representing your end-user
  user?: string;
};

const createOpenAICompletions = ({ apiKey }: { apiKey: string }) => {
  return {
    async getCompletions({
      prompt,
      maxTokens,
      numCompletions = 1,
    }: BaseOpenAICompletionsParams): Promise<CompletionsResponse> {
      const baseUrl = "https://api.openai.com/";
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      const body = {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: `$${prompt}` }],
      };

      const completionsEndpoint = "v1/chat/completions";

      console.log(`Creating request to ${baseUrl} ${completionsEndpoint}`);

      // Set up the fetcher function
      const fetchCompletions = createFetcher({ baseUrl });

      try {
        const response = await fetchCompletions.post<CompletionsResponse>({
          endpoint: completionsEndpoint,
          headers,
          params: body,
        });

        return response;
      } catch (error) {
        console.error("Error fetching completions:", error);
        throw error;
      }
    },
  };
};

export default createOpenAICompletions;
