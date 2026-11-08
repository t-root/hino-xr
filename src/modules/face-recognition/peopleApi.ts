import { ENV } from "@/env";

/** A person the headset knows, as the model server keeps them. */
export type Person = Readonly<{
  id: string;
  name: string;
  year: number | null;
  info: string;
  samples: readonly (readonly number[])[];
}>;

export type PersonFields = Readonly<{ name?: string; year?: number | null; info?: string }>;

const base = (): string => `${ENV.BASE_URL}api/people`;

const failure = async (response: Response): Promise<Error> => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return new Error(body.detail);
  } catch {
    // Not JSON: the status is all there is.
  }
  return new Error(`server answered ${response.status}`);
};

const send = async (url: string, init?: RequestInit): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("offline");
  }
  if (!response.ok) throw await failure(response);
  return response;
};

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The people kept on this computer, with the numbers of their faces. */
export const listPeople = async (): Promise<readonly Person[]> =>
  ((await (await send(base())).json()) as { people: Person[] }).people;

export const createPerson = async (fields: Required<Pick<PersonFields, "name">> & PersonFields, embedding: readonly number[] | null): Promise<Person> =>
  (await (await send(base(), json("POST", { ...fields, ...(embedding ? { embedding } : {}) }))).json()) as Person;

export const updatePerson = async (id: string, fields: PersonFields): Promise<Person> =>
  (await (await send(`${base()}/${encodeURIComponent(id)}`, json("PATCH", fields))).json()) as Person;

export const addSample = async (id: string, embedding: readonly number[]): Promise<Person> =>
  (await (await send(`${base()}/${encodeURIComponent(id)}/samples`, json("POST", { embedding }))).json()) as Person;

export const removePerson = async (id: string): Promise<void> => {
  await send(`${base()}/${encodeURIComponent(id)}`, { method: "DELETE" });
};
