import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export default prisma;
// single instance of PrismaClient
// to avoid multiple connections to the database