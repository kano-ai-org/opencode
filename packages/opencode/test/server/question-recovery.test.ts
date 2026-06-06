import { describe, expect, test } from "bun:test"
import { Question } from "../../src/question"
import { QuestionID } from "../../src/question/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { createQuestionReplyRecoveryPlan } from "../../src/server/routes/instance/httpapi/handlers/question-recovery"

const sessionID = SessionID.make("ses_question_recovery")
const assistantMessageID = MessageID.make("msg_question")
const userMessageID = MessageID.make("msg_user")
const toolPartID = PartID.make("prt_question")
const callID = "call-question"

function request(): Question.Request {
  return {
    id: QuestionID.make("que_recover"),
    sessionID,
    questions: [
      {
        question: "What should we do next?",
        header: "Next",
        options: [{ label: "Ship it", description: "Finish the work" }],
      },
    ],
    tool: {
      messageID: assistantMessageID,
      callID,
    },
  }
}

function assistant(parts: MessageV2.Part[] = []): MessageV2.WithParts {
  return {
    info: {
      id: assistantMessageID,
      sessionID,
      role: "assistant",
      parentID: userMessageID,
      modelID: ModelID.make("gpt-5"),
      providerID: ProviderID.make("openai"),
      mode: "build",
      agent: "codex",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1 },
    },
    parts,
  }
}

function user(input?: { id?: MessageID; synthetic?: boolean }): MessageV2.WithParts {
  return {
    info: {
      id: input?.id ?? userMessageID,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "codex",
      model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
    },
    parts: [
      {
        id: PartID.make(`prt_${String(input?.id ?? "user")}`),
        sessionID,
        messageID: input?.id ?? userMessageID,
        type: "text",
        text: "continue",
        synthetic: input?.synthetic,
      },
    ],
  }
}

function questionTool(status: "running" | "completed" | "error" = "running"): MessageV2.ToolPart {
  return {
    id: toolPartID,
    sessionID,
    messageID: assistantMessageID,
    type: "tool",
    callID,
    tool: "question",
    state:
      status === "completed"
        ? {
            status: "completed",
            input: { questions: [] },
            output: "done",
            title: "Asked 1 question",
            metadata: {},
            time: { start: 1, end: 2 },
          }
        : status === "error"
          ? {
              status: "error",
              input: { questions: [] },
              error: "dismissed",
              time: { start: 1, end: 2 },
            }
          : {
              status: "running",
              input: { questions: [] },
              time: { start: 1 },
            },
  }
}

describe("createQuestionReplyRecoveryPlan", () => {
  test("completes the running question tool and finalizes the assistant message", () => {
    const plan = createQuestionReplyRecoveryPlan({
      messages: [user(), assistant([questionTool()])],
      request: request(),
      answers: [["Ship it"]],
      now: 99,
    })

    expect(plan).toMatchObject({
      sessionID,
      requestID: "que_recover",
      message: {
        id: assistantMessageID,
        finish: "tool-calls",
        time: { completed: 99 },
      },
      part: {
        id: toolPartID,
        state: {
          status: "completed",
          title: "Asked 1 question",
          metadata: { answers: [["Ship it"]] },
          time: { start: 1, end: 99 },
        },
      },
    })
    expect(plan?.part.state.status).toBe("completed")
    if (plan?.part.state.status === "completed") {
      expect(plan.part.state.output).toContain('"What should we do next?"="Ship it"')
    }
  })

  test("does not recover once a newer real user turn already exists", () => {
    const plan = createQuestionReplyRecoveryPlan({
      messages: [
        user(),
        assistant([questionTool()]),
        user({ id: MessageID.make("msg_newer") }),
      ],
      request: request(),
      answers: [["Ship it"]],
      now: 99,
    })

    expect(plan).toBeUndefined()
  })

  test("does not recover questions whose tool part is already terminal", () => {
    const plan = createQuestionReplyRecoveryPlan({
      messages: [user(), assistant([questionTool("completed")])],
      request: request(),
      answers: [["Ship it"]],
      now: 99,
    })

    expect(plan).toBeUndefined()
  })
})
