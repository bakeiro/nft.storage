import { script } from 'subprogram'
import readConfig from '../config.js'
import fauna from 'faunadb'

const {
  Client,
  Create,
  Collection,
  Get,
  Var,
  Documents,
  Lambda,
  Paginate,
  Ref,
  Map,
  Do,
} = fauna

export const main = async () => await run(await readConfig())

/**
 *
 * @param {{secret:string, cursor?:string, size:number}} config
 */
export const run = async (config) => {
  console.log(`🚧 Performing migration`)

  const client = new Client({ secret: config.secret })
  const cursor = config.cursor
    ? Ref(Collection('TokenAsset', config.cursor))
    : undefined
  const state = { cursor, linked: 0, failed: 0, queued: 0 }

  while (true) {
    // Fetch page of TokenAsset from the db.
    const { after, data } = /** @type {{after:fauna.Expr|null, data:any[]}} */ (
      await client.query(
        Map(
          Paginate(Documents(Collection('TokenAsset')), {
            size: config.size,
            after: state.cursor,
          }),
          Lambda(['ref'], Get(Var('ref')))
        )
      )
    )

    // Create a document that corresponds to it's status
    const expressions = []
    for (const tokenAsset of data) {
      switch (tokenAsset.status) {
        case 'Linked':
          state.linked += 1
          expressions.push(
            Create(Collection('Analyzed'), {
              data: {
                tokenAsset: tokenAsset.ref,
                attempt: 1,
              },
            })
          )
          break
        case 'Queued':
          state.queued += 1
          expressions.push(
            Create(Collection('ScheduledAnalyze'), {
              data: {
                tokenAsset: tokenAsset.ref,
                attempt: 1,
              },
            })
          )
          break
        default:
          expressions.push(
            Create(Collection('FailedAnalyze'), {
              data: {
                tokenAsset: tokenAsset.ref,
                attempt: 1,
                status: tokenAsset.status,
                statusText: tokenAsset.statusText,
              },
            })
          )
          state.failed += 1
          break
      }
    }

    // If there was nothing we're done
    if (expressions.length === 0 || after === null) {
      console.log('🏁 Migration is complete', state)
      break
    } else {
      await client.query(Do(expressions))
      console.log(data.map((item) => item.ref))
      state.cursor = after
      console.log('⏭ Moving to next page', state)
    }
  }
}

script({ ...import.meta, main })