import { Router } from "express"
import { ObjectId} from "mongodb"
import { z } from 'zod'
import { getDb } from "../db.js"
import { validate } from "../middleware/validate.js"

const router = Router()

const reportsSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id'),
    reports: z.string().trim().min(1),
})

const listingParamsSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id')
})
router.post('/' , validate({body: reportsSchema}), async (req , res) => {
    const {listingId , reports} = req.body
    const listing = await getDb().collection('listings').findOne({
        _id: new ObjectId(listingId)
    })

    if (!listing) {
        return res.status(404).json({error: 'listing not found'})
    }
    
    const newReports = {
        listingId: new ObjectId(listingId),
        userId: req.user._id,
        reports,
        createdAt: new Date()
    }

    newReports._id = (await getDb().collection('reports').insertOne(newReports)).insertedId
    res.status(201).json(newReports)
})


export default router