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

router.get('/:listingId', async (req, res) => {
    const { listingId } = req.params

    const reports = await getDb().collection('reports')
        .aggregate([
            {
                $match: {
                    listingId: new ObjectId(listingId)
                }
            },
            {
                $sort: {
                    createdAt: 1
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: {
                    path: '$user',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 1,
                    listingId: 1,
                    reports: 1,
                    createdAt: 1,
                    firstName: '$user.firstName',
                    lastName: '$user.lastName'
                }
            }
        ])
        .toArray()

    res.json(reports)
})

export default router