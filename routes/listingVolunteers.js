import { Router } from "express"
import { ObjectId} from "mongodb"
import { z } from 'zod'
import { getDb } from "../db"
import { validate } from "../middleware/validate"
import { forbidden, notFound } from '../middleware/errors.js';

const router = Router()
const listingParamsSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id')
})

router.get('/:listingId' , validate({params: listingParamsSchema}), async (req , res , next) => {
    const listing = await getDb().collection('listings').findOne({
        _id: new ObjectId(req.params.listingId)
    })

    if (!listing) {
        return res.status(404).json({error: 'listing not found'})
    }

    const volunteers = await getDb().collection('users').find({
        _id: {$in: listing.volunteers}
    })
    .project({
        firstName: 1,
        lastName: 1,
        pfp: 1
    }).toArray()

    res.json(volunteers)
})

export default router